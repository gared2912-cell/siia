// Fuente única de datos del sitio. Contenido tomado de "PRESENTACION SIIA.pdf";
// estructura de "SIIA - Propuesta y Estructura..." y "SIIA - Matriz y Plan de Desarrollo Web.xlsx".
// Los campos marcados con PENDIENTE requieren confirmación del cliente antes de producción.

export const site = {
  name: 'SIIA',
  // SIIA = Sistemas Integrales Inmobiliarios y de Administración
  fullName: 'Sistemas Integrales Inmobiliarios y de Administración',
  legalName: 'SIIA · Sistemas Integrales Inmobiliarios y de Administración',
  tagline: 'Administración de Condominios',
  slogan: 'Queremos mantener la plusvalía de tu propiedad, mientras tú disfrutas de tu hogar.',
  description:
    'SIIA, Sistemas Integrales Inmobiliarios y de Administración: administración de condominios y fraccionamientos transparente, profesional y tecnológica. Servicios administrativos, operativos, contables, legales, sociales, capacitaciones y proyectos.',
  email: 'info@siia.casa',
  phones: [
    { label: '446 123 1669', tel: '+524461231669' },
    { label: '442 463 4412', tel: '+524424634412' },
  ],
  // Número para el botón flotante y formularios (WhatsApp Business). PENDIENTE: confirmar número.
  whatsapp: '524461231669',
  // PENDIENTE: horario de atención (no viene en la presentación). null = no se muestra.
  schedule: null as string | null,
  // PENDIENTE: URL de la plataforma de residentes. null = el portal muestra "solicita tu acceso".
  residentsPortalUrl: null as string | null,
  // PENDIENTE: zonas de cobertura y dirección de oficina (no vienen en la presentación).
  coverage: null as string[] | null,
  address: null as string | null,
  repse: true,
};

export const nav = [
  { href: '/', label: 'Inicio' },
  { href: '/servicios/', label: 'Servicios' },
  { href: '/nosotros/', label: 'Nosotros' },
  { href: '/cotizar/', label: 'Cotizar' },
  { href: '/contacto/', label: 'Contacto' },
];

export const waLink = (text: string, number = site.whatsapp) =>
  `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

// Propuesta de valor en 4 pilares (Propuesta, sección B)
export const pillars = [
  {
    icon: 'transparencia',
    title: 'Transparencia total',
    text: 'Cuentas claras, balance mensual de ingresos y egresos y estados financieros transparentes. Tu condominio como caja de cristal.',
  },
  {
    icon: 'mantenimiento',
    title: 'Mantenimiento y plusvalía',
    text: 'Mantenimientos preventivos y correctivos oportunos para conservar áreas comunes, equipamiento y el valor de tu patrimonio.',
  },
  {
    icon: 'seguridad',
    title: 'Seguridad y control',
    text: 'Bitácora de visitas, consignas de seguridad, automatización de accesos y circuito cerrado de vigilancia.',
  },
  {
    icon: 'legal',
    title: 'Gestión legal y mediación',
    text: 'Gestión de asambleas, reglamento interno, mediación de conflictos y recuperación de cartera vencida.',
  },
];

// Beneficios (Presentación, pág. 03)
export const benefits = [
  {
    title: 'Plusvalía',
    image: 'plusvalia',
    intro: 'Cuidamos de tu patrimonio mientras tú lo disfrutas.',
    items: ['Mantenimientos oportunos', 'Proyectos', 'Gestión social para un ambiente vecinal agradable'],
    outro: 'Buscamos siempre lo mejor para ti, tu familia y tu hogar.',
  },
  {
    title: 'Certidumbre',
    image: 'certidumbre',
    intro: 'Te brindamos certidumbre a través de la gestión integral de tu condominio.',
    items: [
      'Herramientas que aseguran transparencia en la información',
      'Empresa legalmente constituida con registro REPSE en administración de condominios',
      'Personal altamente capacitado',
    ],
  },
  {
    title: 'Confort y armonía',
    image: 'confort',
    intro: 'Nos encargamos de hacer lo necesario para lograr armonía en cada rincón de tu condominio.',
    items: [],
    outro: 'Nuestro servicio te brinda confort, plusvalía y seguridad para tu hogar.',
  },
];

export type Service = {
  id: string;
  num: string;
  title: string;
  short: string;
  image: string;
  groups: { title?: string; items: string[] }[];
};

// Nuestros servicios (Presentación, págs. 04–14)
export const services: Service[] = [
  {
    id: 'administrativos',
    num: '01',
    title: 'Administrativos',
    short: 'Atención personalizada, reportes mensuales, cobranza y supervisión constante de tu condominio.',
    image: 'administrativo',
    groups: [
      {
        title: 'Atención y reportes',
        items: [
          'Atención a cliente personalizada (WhatsApp, llamada, app, correo, etc.)',
          'Balance mensual de ingresos y egresos',
          'Reporte de actividades mensual',
          'Reporte ejecutivo a comités',
          'Reporte de morosidad',
          'Reporte de aplicación de multas',
          'Estado de cuenta de mantenimiento de cada residente',
          'Cronograma de actividades',
        ],
      },
      {
        title: 'Cobranza y finanzas',
        items: [
          'Gestión de cobranza',
          'Recuperación de cartera vencida',
          'Pago y control administrativo de proveedores',
          'Gestión de pago de agua, luz y otros servicios',
          'Firmas mancomunadas',
          'Administración de agua',
        ],
      },
      {
        title: 'Gestión y convivencia',
        items: [
          'Recepción y seguimiento de incidentes',
          'Mediación de conflictos',
          'Implementación de formatos de seguimiento',
          'Coordinación de proyectos',
          'Agenda de amenidades',
          'Bitácora de visitas',
          "TIC'S: app móvil de la administración",
          'Supervisión de seguridad privada (en caso de contar con este servicio)',
          'Apoyo y orientación a mesa directiva',
          'Programa mascota segura',
          'Propuesta, gestión y supervisión de proyectos de mejora',
          'Supervisión constante',
        ],
      },
    ],
  },
  {
    id: 'operativos',
    num: '02',
    title: 'Operativos',
    short: 'Mantenimiento preventivo y correctivo, coordinación de proveedores y servicios para áreas comunes.',
    image: 'operativo',
    groups: [
      {
        title: 'Planeación y proveedores',
        items: [
          'Programación y planeación de mantenimiento',
          'Programación de mantenimientos preventivos',
          'Programación de mantenimientos correctivos',
          'Pago a proveedores',
          'Consignas de seguridad',
          'Coordinación de proveedores',
          'Programación y planeación de trabajo de proveedores',
          'Búsqueda de proveedores que mejoren servicios y costos',
          'Propuesta, gestión y supervisión de proyectos de mejora en cada área del condominio',
        ],
      },
      {
        title: 'Servicios para tu condominio',
        items: [
          'Conserjería',
          'Limpieza general y profunda',
          'Jardinería',
          'Paisajismo',
          'Mantenimiento de albercas',
          'Mantenimiento y reparación de sistema de riego',
          'Reparaciones en general',
          'Fumigación',
          'Bacheo',
          'Pintura',
          'Automatización de accesos (vehicular, peatonal, alberca, contenedores de basura)',
          'Sistema de circuito cerrado de vigilancia',
        ],
      },
    ],
  },
  {
    id: 'contables',
    num: '03',
    title: 'Contables',
    short: 'Finanzas claras y en orden: estados financieros transparentes, presupuesto y obligaciones ante el SAT.',
    image: 'contable',
    groups: [
      {
        items: [
          'Balance mensual de ingresos y egresos',
          'Estados financieros transparentes',
          'Finanzas claras y en orden',
          'Declaraciones anuales ante el SAT',
          'Gestión de pagos',
          'Planeación y control de gastos',
          'Control de presupuesto',
          'Registro y actualización de matriz de pagos',
          'Asesoría para mejorar el rendimiento financiero del condominio',
          'Inventario',
          'Facturación y solicitud de facturas de proveedores',
        ],
      },
    ],
  },
  {
    id: 'legales',
    num: '04',
    title: 'Legales',
    short: 'Asambleas, reglamento interno, contratos, trámites y recuperación de cartera vencida.',
    image: 'legal',
    groups: [
      {
        items: [
          'Revisión de documentación del condominio para regularización',
          'Gestión de asambleas',
          'Revisión de contratos de proveedores',
          'Asesoría para trámites ante notario',
          'Revisión de reglamento interno',
          'Modificaciones de reglamento interno',
          'Formalización de asociación civil',
          'Asesoría para creación de cuenta bancaria del condominio',
          'Trámites gubernamentales',
          'Gestión de recuperación de cartera vencida',
          'Asesoría legal',
          'Solicitud de apoyos gubernamentales para condominios',
        ],
      },
    ],
  },
  {
    id: 'sociales',
    num: '05',
    title: 'Sociales',
    short: 'Fortalecemos la sana convivencia con campañas, eventos y recuperación de espacios.',
    image: 'social',
    groups: [
      {
        items: [
          'Recuperación de espacios a través de eventos o proyectos',
          'Fortalecimiento de sana convivencia condominal',
          'Campañas de mejora continua con participación de la gente',
          'Campañas de mejora de jardines con donación de plantas por parte de SIIA',
          'Campañas de salud en el condominio',
          'Campañas culturales en el condominio',
          'Actividades de convivencia vecinal (Halloween, Día de Muertos, posadas y fiestas decembrinas, entre otras)',
        ],
      },
    ],
  },
  {
    id: 'capacitaciones',
    num: '06',
    title: 'Capacitaciones',
    short: 'Formación para condóminos, mesas directivas y comités de vigilancia.',
    image: 'capacitacion',
    groups: [
      {
        items: [
          'Mediación comunitaria para condóminos',
          'Primeros auxilios para condóminos',
          'Seguridad para condóminos',
          'Reciclaje para condóminos',
          'Capacitación a mesas directivas',
          'Capacitación a comités de vigilancia',
        ],
      },
    ],
  },
  {
    id: 'proyectos',
    num: '07',
    title: 'Proyectos',
    short: 'Transformamos los espacios que lo requieren con proyectos a la medida de tu presupuesto.',
    image: 'proyectos',
    groups: [
      {
        items: [
          'Propuestas de mejora en tu condominio',
          'Transformamos los espacios que lo requieren para mejorarlos',
          'Espacios excepcionales para disfrutar con tu familia',
          'Proyectos adaptados a las necesidades y presupuesto de tu condominio',
          'Proyectos personalizados',
        ],
      },
    ],
  },
];

// TIC'S: app para residentes, vigilantes y administración (Presentación, pág. 13)
export const appFeatures = [
  'Control de finanzas',
  'Registro y control de visitas',
  'Encuestas electrónicas',
  'Recibos',
  'Control de mantenimientos',
  'Control de incidentes',
  'Comunicados y notificaciones de la administración',
  'Chat con caseta de vigilancia y administración',
  'Registro de servicios con alerta desde caseta',
  'Programa mascota segura',
];

// Cuota de mantenimiento (Presentación, pág. 15)
export const maintenanceFee = [
  'Nuestra prioridad es optimizar los recursos a través de un análisis de los gastos del condominio.',
  'Cuando se requieren proveedores para atención, mantenimientos y reparaciones, buscamos la mejor opción entre calidad y precio.',
  'Hacemos una comparativa que se presenta y consensa con la mesa directiva antes de cualquier contratación.',
];

export const quoteNote = 'Cotizamos los servicios que requiera tu condominio, cuidando tu presupuesto.';

export const propertyTypes = [
  'Condominio horizontal',
  'Condominio vertical (edificio)',
  'Fraccionamiento cerrado',
  'Uso mixto / otro',
];
