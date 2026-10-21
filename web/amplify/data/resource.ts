import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { adminApi } from '../functions/admin-api/resource';
import { portalApi } from '../functions/portal-api/resource';

// Modelo de datos del portal de residentes.
// - Solo el grupo SUPERADMIN lee tablas directo. Los administradores (ADMIN) pasan por la mutación
//   `admin`, cuya Lambda aplica su rol de administración (RolAdmin) y sus condominios asignados.
// - Residentes y vigilantes NUNCA leen tablas directo: todo pasa por la mutación `portal`,
//   cuya Lambda valida que el usuario esté aprobado, su rol, su condominio/unidad
//   y que el servicio (módulo) esté habilitado por un administrador.

const admin = (allow: any) => [allow.group('SUPERADMIN')];

const schema = a
  .schema({
    Rol: a.enum(['SUPERADMIN', 'ADMIN', 'RESIDENTE', 'VIGILANTE', 'PROVEEDOR']),
    EstadoPerfil: a.enum(['PENDIENTE', 'APROBADO', 'RECHAZADO', 'SUSPENDIDO']),

    // Rol de administración: qué secciones y acciones puede usar un ADMIN (ver shared/permisos.ts).
    RolAdmin: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        nombre: a.string().required(),
        descripcion: a.string(),
        permisos: a.json(), // { secciones: { finanzas: 'editar' | 'ver' | 'ninguno', … }, extras: ['finanzas.validarPagos', …] }
      })
      .authorization(admin),

    Condominio: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        nombre: a.string().required(),
        tipo: a.string(),
        direccion: a.string(),
        // Módulos (servicios) habilitados por la administración: finanzas, visitas, comunicados,
        // encuestas, chat, incidentes, mantenimientos, amenidades, mascotas
        modulos: a.string().array(),
        activo: a.boolean().default(true),
        datosPago: a.string(), // texto que ve el residente en Finanzas (se arma con los campos bancarios + notas)
        // Datos bancarios para el pago de cuotas
        banco: a.string(),
        beneficiario: a.string(),
        clabe: a.string(),
        cuentaBancaria: a.string(),
        referenciaPago: a.string(),
        notasPago: a.string(),
        // Unidades: CASA o DEPARTAMENTO (prefijo de la etiqueta: «Casa 12», «Depto A-101»)
        tipoUnidad: a.string(),
        // Cuota de mantenimiento única para todas las unidades y día del mes en que vence
        cuotaMensual: a.float(),
        diaVencimiento: a.integer(),
        // Recargo por pago tardío: monto fijo que se carga al día siguiente del vencimiento si la cuota sigue sin pagar
        recargoActivo: a.boolean(),
        recargoMonto: a.float(),
        recargoDesde: a.date(), // solo cuotas que vencen a partir de esta fecha (cuando se activó)
        // Cuota automática: cada mes, el día diaCargo (1 a 28), se genera la cuota de mantenimiento de todas las unidades
        cuotaAutomatica: a.boolean(),
        diaCargo: a.integer(),
        cuotaAutomaticaDesde: a.date(), // solo meses cuya fecha de cargo es a partir de esta fecha (cuando se activó)
        // Archivos importantes: [{ slot: 'reglamento' | 'doc1' | 'doc2', titulo, path, nombre, tamano, subido }]
        documentos: a.json(),
        telefonoCaseta: a.string(),
        // Lugares de estacionamiento para visitas (0 o vacío = no se lleva el control)
        estacionamientoVisitas: a.integer(),
        // Servicios que entran al condominio (basura, gas, agua…): la caseta avisa a todos los residentes cuando llegan
        serviciosCondominio: a.string().array(),
        folioSeq: a.integer(),
        // Solo el SUPERADMIN suspende o elimina un condominio (admin-api condominios.*; ver shared/condominios.ts).
        // Suspendido: nadie de ese condominio entra (residentes, caseta ni sus administradores) y no corren cuotas ni recargos.
        suspendido: a.boolean(),
        suspension: a.json(), // { motivo, en, por, porNombre }
        // Papelera: oculto para todos; la Lambda siia-papelera lo borra con todos sus datos 30 días después de eliminadoEn.
        eliminadoEn: a.datetime(),
        eliminacion: a.json(), // { por, porNombre, cuentas: [userId desactivados], purgando }
      })
      .authorization(admin),

    Unidad: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        etiqueta: a.string().required(), // Casa 12, Depto 3B…
        cuota: a.float(), // histórico: la cuota vigente es Condominio.cuotaMensual
        propietario: a.string(),
        fechaEntrega: a.date(),
        notas: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('unidadesPorCondominio')])
      .authorization(admin),

    Perfil: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        userId: a.id().required(), // sub de Cognito
        email: a.string().required(),
        nombre: a.string(),
        telefono: a.string(),
        telefono2: a.string(), // segundo teléfono de contacto
        rol: a.ref('Rol'),
        estado: a.ref('EstadoPerfil'),
        condominioId: a.id(),
        unidadId: a.id(),
        unidadSolicitada: a.string(), // texto que escribió el residente al solicitar acceso
        nota: a.string(),
        // Solo ADMIN: rol de administración y condominios que atiende (['*'] = todos)
        rolAdminId: a.id(),
        condominiosAdmin: a.string().array(),
        // Categorías de notificación push que el usuario apagó (ver shared/notificaciones.ts)
        notifApagadas: a.string().array(),
        // Notificaciones en silencio (sin sonido ni vibración) en todos sus dispositivos
        notifSilencio: a.boolean(),
        // Solo RESIDENTE: último mensaje de la administración / caseta que ya vio (createdAt), para el contador de chat
        chatLeidoAdmin: a.string(),
        // Solo RESIDENTE: llaveros, tarjetas, controles… asignados (ver shared/accesos.ts)
        accesos: a.json(),
        chatLeidoCaseta: a.string(),
        // Alta (o cambio de correo) sin enviar los accesos por correo: falta enviarlos o asignarle contraseña.
        accesoSinEnviar: a.boolean(),
        // Solo PROVEEDOR (ver shared/proveedores.ts): empresa (vacío = personal propio), servicios que da y condominios que atiende
        empresa: a.string(),
        servicios: a.string().array(),
        condominiosServicio: a.string().array(),
      })
      .identifier(['userId'])
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('perfilesPorCondominio')])
      .authorization(admin),

    Cargo: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        concepto: a.string().required(),
        periodo: a.string(), // AAAA-MM
        monto: a.float().required(),
        vence: a.date(),
        estado: a.enum(['PENDIENTE', 'PAGADO', 'CANCELADO']),
        // Tipo de ingreso para el balance (ver shared/finanzas.ts); los cargos anteriores se clasifican por su id.
        tipo: a.string(),
      })
      .secondaryIndexes((i) => [
        i('unidadId').name('byUnidad').queryField('cargosPorUnidad'),
        i('condominioId').name('byCondominio').queryField('cargosPorCondominio'),
      ])
      .authorization(admin),

    Pago: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        monto: a.float().required(),
        fecha: a.date(),
        referencia: a.string(),
        comprobantePath: a.string(),
        cargoIds: a.string().array(),
        estado: a.enum(['EN_REVISION', 'VALIDADO', 'RECHAZADO']),
        folio: a.string(),
        nota: a.string(),
        validadoPor: a.string(),
        validadoEn: a.datetime(),
      })
      .secondaryIndexes((i) => [
        i('unidadId').name('byUnidad').queryField('pagosPorUnidad'),
        i('condominioId').name('byCondominio').queryField('pagosPorCondominio'),
      ])
      .authorization(admin),

    // Gasto del condominio con su evidencia: [{ path, nombre, tipo, tamano }] (1 a 5 archivos PDF o imagen).
    Egreso: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        fecha: a.date().required(),
        categoria: a.string().required(),
        concepto: a.string().required(),
        proveedor: a.string(),
        formaPago: a.string(),
        monto: a.float().required(),
        evidencias: a.json(),
        // AMENIDADES: gasto pagado con el fondo de amenidades (se descuenta del ahorro de amenidades)
        fondo: a.string(),
        registradoPor: a.string(),
        registradoPorNombre: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('egresosPorCondominio')])
      .authorization(admin),

    // Saldo inicial capturado a mano para un mes (id = <condominioId>#AAAA-MM). Sin registro, el saldo inicial
    // es el saldo final del mes anterior.
    SaldoMensual: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        periodo: a.string().required(),
        saldoInicial: a.float().required(),
        nota: a.string(),
        editadoPor: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('saldosPorCondominio')])
      .authorization(admin),

    Comunicado: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        titulo: a.string().required(),
        cuerpo: a.string().required(),
        importante: a.boolean(),
        autor: a.string(),
        // Rutas en S3 de las imágenes del comunicado (condominios/{id}/comunicados/…), en orden; máximo 6
        imagenes: a.string().array(),
        // Rutas en S3 de los PDF adjuntos (convocatorias, invitaciones, orden del día…); máximo 5
        adjuntos: a.string().array(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('comunicadosPorCondominio')])
      .authorization(admin),

    Encuesta: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        pregunta: a.string().required(),
        descripcion: a.string(),
        opciones: a.string().array().required(),
        cierra: a.date(),
        estado: a.enum(['ABIERTA', 'CERRADA']),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('encuestasPorCondominio')])
      .authorization(admin),

    // id = encuestaId#unidadId → un voto por unidad
    Voto: a
      .model({
        encuestaId: a.id().required(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        opcion: a.string().required(),
        userId: a.id(),
      })
      .secondaryIndexes((i) => [i('encuestaId').name('byEncuesta').queryField('votosPorEncuesta')])
      .authorization(admin),

    // hilo = condominioId#unidadId#CANAL (ADMIN | CASETA)
    Mensaje: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        canal: a.enum(['ADMIN', 'CASETA']),
        hilo: a.string().required(),
        autorId: a.string(),
        autorNombre: a.string(),
        autorRol: a.string(),
        texto: a.string().required(),
        // Foto adjunta (S3): de residentes y caseta en su carpeta; de la administración en condominios/<id>/chat/
        imagenPath: a.string(),
      })
      .secondaryIndexes((i) => [
        i('hilo').name('byHilo').queryField('mensajesPorHilo'),
        i('condominioId').name('byCondominio').queryField('mensajesPorCondominio'),
      ])
      .authorization(admin),

    Incidente: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        categoria: a.string(),
        titulo: a.string().required(),
        descripcion: a.string(),
        ubicacion: a.string(),
        fotoPath: a.string(),
        // Etapas: Abierto → En seguimiento → En proceso → Cerrado (RESUELTO queda solo para registros anteriores)
        estado: a.enum(['ABIERTO', 'EN_SEGUIMIENTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO']),
        respuesta: a.string(),
        // Seguimiento: cada cambio de estado con su foto de evidencia y quién lo hizo
        // [{ estado, respuesta, fotoPath, por, porNombre, en }]. Cerrado = ya no se puede atender.
        evidenciaPath: a.string(), // última foto de evidencia
        historial: a.json(),
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('incidentesPorCondominio'),
        i('unidadId').name('byUnidad').queryField('incidentesPorUnidad'),
      ])
      .authorization(admin),

    Mantenimiento: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        titulo: a.string().required(),
        tipo: a.enum(['PREVENTIVO', 'CORRECTIVO']),
        area: a.string(),
        fecha: a.date(),
        estado: a.enum(['PROGRAMADO', 'EN_PROCESO', 'TERMINADO']),
        proveedor: a.string(),
        notas: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('mantenimientosPorCondominio')])
      .authorization(admin),

    Amenidad: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        nombre: a.string().required(),
        descripcion: a.string(),
        horaApertura: a.string(), // HH:MM
        horaCierre: a.string(),
        maxHoras: a.integer(),
        capacidad: a.integer(),
        costo: a.float(),
        requiereAprobacion: a.boolean(),
        activa: a.boolean(),
        reglas: a.string(),
        // Sección de otra amenidad (p. ej. «Terraza» de «Casa club»): reservar la completa bloquea sus secciones
        // en ese horario, y reservar una sección bloquea la completa (las demás secciones siguen libres).
        parteDeId: a.id(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('amenidadesPorCondominio')])
      .authorization(admin),

    Reserva: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        amenidadId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        fecha: a.date().required(),
        horaInicio: a.string().required(),
        horaFin: a.string().required(),
        invitados: a.integer(),
        // PENDIENTE_PAGO: tiene cargo y se aprueba al validar el pago. Solo APROBADA bloquea el calendario.
        estado: a.enum(['PENDIENTE_PAGO', 'SOLICITADA', 'APROBADA', 'RECHAZADA', 'CANCELADA']),
        nota: a.string(),
        terminosAceptados: a.datetime(), // cuándo aceptó el reglamento y los términos de uso al reservar
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('reservasPorCondominio'),
        i('amenidadId').name('byAmenidad').queryField('reservasPorAmenidad'),
        i('unidadId').name('byUnidad').queryField('reservasPorUnidad'),
      ])
      .authorization(admin),

    Visita: a
      .model({
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        tipo: a.enum(['VISITA', 'SERVICIO', 'PROVEEDOR', 'PAQUETERIA']),
        nombre: a.string().required(),
        placas: a.string(),
        fecha: a.date().required(),
        fechaFin: a.date(),
        codigo: a.string(),
        origen: a.enum(['RESIDENTE', 'CASETA']),
        // POR_AUTORIZAR: llegó sin pase y la caseta pidió permiso al residente → AUTORIZADA (puede entrar) o RECHAZADA
        estado: a.enum(['PROGRAMADA', 'POR_AUTORIZAR', 'AUTORIZADA', 'RECHAZADA', 'DENTRO', 'SALIO', 'CANCELADA']),
        entradaEn: a.datetime(),
        salidaEn: a.datetime(),
        registradoPor: a.string(),
        notas: a.string(),
        // Llega en auto; al entrar ocupa un lugar de estacionamiento de visitas (ocupaLugar) hasta que sale
        enAuto: a.boolean(),
        ocupaLugar: a.boolean(),
        // Solicitud de acceso sin pase: quién la pidió en caseta y quién respondió (residente o caseta por llamada)
        solicitadoPor: a.string(),
        solicitadoEn: a.datetime(),
        respuestaPor: a.string(),
        respuestaEn: a.datetime(),
        respuestaVia: a.string(), // RESIDENTE | LLAMADA
        respuestaNota: a.string(),
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('visitasPorCondominio'),
        i('unidadId').name('byUnidad').queryField('visitasPorUnidad'),
        i('codigo').name('byCodigo').queryField('visitasPorCodigo'),
      ])
      .authorization(admin),

    // Registro de vigilancia: cambio de turno con foto del guardia en caseta y de la caseta limpia, equipo entregado y
    // notas. No se edita: solo se agregan notas [{ texto, en, por }].
    TurnoVigilancia: a
      .model({
        condominioId: a.id().required(),
        entra: a.string().required(),
        sale: a.string().required(),
        registradoPor: a.string(),
        registradoId: a.string(),
        fotoGuardiaPath: a.string().required(),
        fotoCasetaPath: a.string().required(),
        casetaLimpia: a.boolean(),
        equipo: a.string().array(),
        notas: a.json(),
        visitasDentro: a.integer(),
        lugaresOcupados: a.integer(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('turnosPorCondominio')])
      .authorization(admin),

    // Notificaciones para una unidad (alertas de caseta, pagos validados, reservas, etc.)
    Aviso: a
      .model({
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        tipo: a.string(),
        titulo: a.string().required(),
        texto: a.string(),
        imagen: a.string(), // ruta pública de una imagen (p. ej. /servicios/basura.jpg en el aviso de servicios)
        leido: a.boolean(),
      })
      .secondaryIndexes((i) => [i('unidadId').name('byUnidad').queryField('avisosPorUnidad')])
      .authorization(admin),

    Mascota: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        nombre: a.string().required(),
        especie: a.string(),
        raza: a.string(),
        color: a.string(),
        fotoPath: a.string(),
        vacunaAntirrabica: a.date(),
        estado: a.enum(['PENDIENTE', 'APROBADA', 'RECHAZADA']),
        extraviada: a.boolean(),
        notas: a.string(),
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('mascotasPorCondominio'),
        i('unidadId').name('byUnidad').queryField('mascotasPorUnidad'),
      ])
      .authorization(admin),

    // Teléfono o navegador con notificaciones push activas (id = hash del endpoint). Solo lo escriben las Lambdas.
    Dispositivo: a
      .model({
        userId: a.id().required(),
        endpoint: a.string().required(),
        p256dh: a.string().required(),
        auth: a.string().required(),
        plataforma: a.string(),
      })
      .secondaryIndexes((i) => [i('userId').name('byUser').queryField('dispositivosPorUsuario')])
      .authorization(admin),

    // Registro de actividad de la administración (solo lo consulta el SUPERADMIN, vía admin-api).
    // condominioId = 'GLOBAL' para cuentas de administración y roles. Ver shared/firma.ts.
    Actividad: a
      .model({
        condominioId: a.string().required(),
        fecha: a.datetime().required(),
        porId: a.string(),
        porNombre: a.string(),
        porEmail: a.string(),
        porRol: a.string(),
        accion: a.string().required(),
        resumen: a.string(),
        cambios: a.json(), // [{ modelo, op, id, etiqueta, campos: [{ campo, antes, despues }] }]
      })
      .secondaryIndexes((i) => [i('condominioId').sortKeys(['fecha']).name('byCondominio').queryField('actividadPorCondominio')])
      .authorization(admin),

    // Registro de activaciones: corte de accesos por morosidad para el técnico (ver shared/cortes.ts).
    CorteAccesos: a
      .model({
        // Firma del administrador (o «SIIA (automático)»): { id, nombre, email, rol, en }. Ver shared/firma.ts.
        firma: a.json(),
        firmaCambio: a.json(),
        condominioId: a.id().required(),
        numero: a.integer().required(),
        fecha: a.datetime().required(),
        porNombre: a.string(),
        criterio: a.json(), // { tipos, extraordinarios, minCuotas }
        resumen: a.json(), // { morosos, monto, porDesactivar, porActivar, desactivados, aplicados }
        filas: a.json(), // [{ unidadId, unidad, userId, residente, moroso, cuotas, extras, monto, accesos: [{ id, tipo, codigo, estado }] }]
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('cortesPorCondominio')])
      .authorization(admin),

    // Bitácora de trabajo de un proveedor (ver shared/proveedores.ts). destino ADMIN = detallado para la administración;
    // RESIDENTES = lo que ven los residentes en Mantenimientos. Lo crea portal-api y ya no se modifica.
    ReporteProveedor: a
      .model({
        condominioId: a.id().required(),
        proveedorId: a.id().required(),
        proveedorNombre: a.string(),
        empresa: a.string(),
        destino: a.string().required(),
        tipo: a.string().required(),
        tipoOtro: a.string(),
        descripcion: a.string(),
        fecha: a.date().required(),
        fotos: a.json(), // [{ path, descripcion }]
      })
      .secondaryIndexes((i) => [
        i('condominioId').sortKeys(['fecha']).name('byCondominio').queryField('reportesProveedorPorCondominio'),
        i('proveedorId').sortKeys(['fecha']).name('byProveedor').queryField('reportesPorProveedor'),
      ])
      .authorization(admin),

    // Solicitudes de cotización y mensajes de contacto del sitio público (Lambda siia-cotizaciones).
    // Siguen pendientes hasta que un administrador marca «Respondido al solicitante».
    Cotizacion: a
      .model({
        origen: a.string().required(), // COTIZACION | CONTACTO
        estado: a.string().required(), // PENDIENTE | RESPONDIDA
        nombre: a.string().required(),
        telefono: a.string(),
        correo: a.string(),
        rol: a.string(),
        tipoDesarrollo: a.string(),
        unidades: a.integer(),
        desarrollo: a.string(),
        ubicacion: a.string(),
        administracionActual: a.string(),
        servicios: a.string().array(),
        motivo: a.string(),
        mensaje: a.string(),
        pagina: a.string(),
        respondidaEn: a.datetime(),
        respondidaPor: a.json(), // { id, nombre, email }
        notaRespuesta: a.string(),
      })
      .authorization(admin),

    // API para residentes y vigilantes (validada en la Lambda portal-api)
    portal: a
      .mutation()
      .arguments({ action: a.string().required(), payload: a.json() })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(portalApi)),

    // Acciones de administración que requieren Cognito o lógica atómica (folios, alta de usuarios)
    admin: a
      .mutation()
      .arguments({ action: a.string().required(), payload: a.json() })
      .returns(a.json())
      .authorization((allow) => [allow.groups(['SUPERADMIN', 'ADMIN'])])
      .handler(a.handler.function(adminApi)),
  })
  // admin-api usa el cliente de datos (IAM) para el CRUD de administradores, con la validación del esquema.
  .authorization((allow) => [allow.resource(adminApi)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
