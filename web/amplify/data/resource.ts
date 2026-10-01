import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { adminApi } from '../functions/admin-api/resource';
import { portalApi } from '../functions/portal-api/resource';

// Modelo de datos del portal de residentes.
// - Los administradores (grupo ADMIN) administran todo directamente vía AppSync.
// - Residentes y vigilantes NUNCA leen tablas directo: todo pasa por la mutación `portal`,
//   cuya Lambda valida que el usuario esté aprobado, su rol, su condominio/unidad
//   y que el servicio (módulo) esté habilitado por un administrador.

const admin = (allow: any) => [allow.group('ADMIN')];

const schema = a
  .schema({
    Rol: a.enum(['ADMIN', 'RESIDENTE', 'VIGILANTE']),
    EstadoPerfil: a.enum(['PENDIENTE', 'APROBADO', 'RECHAZADO', 'SUSPENDIDO']),

    Condominio: a
      .model({
        nombre: a.string().required(),
        tipo: a.string(),
        direccion: a.string(),
        // Módulos (servicios) habilitados por la administración: finanzas, visitas, comunicados,
        // encuestas, chat, incidentes, mantenimientos, amenidades, mascotas
        modulos: a.string().array(),
        activo: a.boolean().default(true),
        datosPago: a.string(), // banco, CLABE, beneficiario, referencia (texto libre)
        telefonoCaseta: a.string(),
        folioSeq: a.integer(),
      })
      .authorization(admin),

    Unidad: a
      .model({
        condominioId: a.id().required(),
        etiqueta: a.string().required(), // Casa 12, Depto 3B…
        cuota: a.float(),
        propietario: a.string(),
        notas: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('unidadesPorCondominio')])
      .authorization(admin),

    Perfil: a
      .model({
        userId: a.id().required(), // sub de Cognito
        email: a.string().required(),
        nombre: a.string(),
        telefono: a.string(),
        rol: a.ref('Rol'),
        estado: a.ref('EstadoPerfil'),
        condominioId: a.id(),
        unidadId: a.id(),
        unidadSolicitada: a.string(), // texto que escribió el residente al solicitar acceso
        nota: a.string(),
      })
      .identifier(['userId'])
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('perfilesPorCondominio')])
      .authorization(admin),

    Cargo: a
      .model({
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        concepto: a.string().required(),
        periodo: a.string(), // AAAA-MM
        monto: a.float().required(),
        vence: a.date(),
        estado: a.enum(['PENDIENTE', 'PAGADO', 'CANCELADO']),
      })
      .secondaryIndexes((i) => [
        i('unidadId').name('byUnidad').queryField('cargosPorUnidad'),
        i('condominioId').name('byCondominio').queryField('cargosPorCondominio'),
      ])
      .authorization(admin),

    Pago: a
      .model({
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

    Comunicado: a
      .model({
        condominioId: a.id().required(),
        titulo: a.string().required(),
        cuerpo: a.string().required(),
        importante: a.boolean(),
        autor: a.string(),
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('comunicadosPorCondominio')])
      .authorization(admin),

    Encuesta: a
      .model({
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
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        canal: a.enum(['ADMIN', 'CASETA']),
        hilo: a.string().required(),
        autorId: a.string(),
        autorNombre: a.string(),
        autorRol: a.string(),
        texto: a.string().required(),
      })
      .secondaryIndexes((i) => [
        i('hilo').name('byHilo').queryField('mensajesPorHilo'),
        i('condominioId').name('byCondominio').queryField('mensajesPorCondominio'),
      ])
      .authorization(admin),

    Incidente: a
      .model({
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        categoria: a.string(),
        titulo: a.string().required(),
        descripcion: a.string(),
        ubicacion: a.string(),
        fotoPath: a.string(),
        estado: a.enum(['ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO']),
        respuesta: a.string(),
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('incidentesPorCondominio'),
        i('unidadId').name('byUnidad').queryField('incidentesPorUnidad'),
      ])
      .authorization(admin),

    Mantenimiento: a
      .model({
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
      })
      .secondaryIndexes((i) => [i('condominioId').name('byCondominio').queryField('amenidadesPorCondominio')])
      .authorization(admin),

    Reserva: a
      .model({
        condominioId: a.id().required(),
        amenidadId: a.id().required(),
        unidadId: a.id().required(),
        userId: a.id(),
        fecha: a.date().required(),
        horaInicio: a.string().required(),
        horaFin: a.string().required(),
        invitados: a.integer(),
        estado: a.enum(['SOLICITADA', 'APROBADA', 'RECHAZADA', 'CANCELADA']),
        nota: a.string(),
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
        estado: a.enum(['PROGRAMADA', 'DENTRO', 'SALIO', 'CANCELADA']),
        entradaEn: a.datetime(),
        salidaEn: a.datetime(),
        registradoPor: a.string(),
        notas: a.string(),
      })
      .secondaryIndexes((i) => [
        i('condominioId').name('byCondominio').queryField('visitasPorCondominio'),
        i('unidadId').name('byUnidad').queryField('visitasPorUnidad'),
        i('codigo').name('byCodigo').queryField('visitasPorCodigo'),
      ])
      .authorization(admin),

    // Notificaciones para una unidad (alertas de caseta, pagos validados, reservas, etc.)
    Aviso: a
      .model({
        condominioId: a.id().required(),
        unidadId: a.id().required(),
        tipo: a.string(),
        titulo: a.string().required(),
        texto: a.string(),
        leido: a.boolean(),
      })
      .secondaryIndexes((i) => [i('unidadId').name('byUnidad').queryField('avisosPorUnidad')])
      .authorization(admin),

    Mascota: a
      .model({
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
      .authorization((allow) => [allow.group('ADMIN')])
      .handler(a.handler.function(adminApi)),
  });

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
