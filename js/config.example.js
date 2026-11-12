// Copia este archivo como js/config.js y pega los datos de tu proyecto Supabase
// (Supabase → Project Settings → API). Solo la clave publicable (publishable / anon), nunca la secret.
window.HORUS_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU-CLAVE-PUBLICABLE",

  // Listas de sugerencias. En los campos con sugerencias igual se puede escribir otro valor.
  OPCIONES: {
    tipo_motor: ["Motor con polea", "Bomba de agua", "Bomba multietapa", "Motor trifásico", "Motor monofásico"],
    tipo_mantenimiento: ["Mantenimiento Correctivo", "Mantenimiento Preventivo", "Rebobinado"],
    rodamientos: ["Delantero", "Trasero", "Delantero y trasero", "Extra"],
    estado: ["Pendiente", "En mantención", "En mantención externa", "Terminado", "Entregado"],
    // Órdenes de trabajo (Omega). Provisorio: se pueden cambiar cuando se definan los tipos reales.
    tipos_orden: ["Instalación eléctrica", "Mantención de tablero", "Reparación de falla", "Empalme / medidor",
      "Iluminación", "Motores y bombas", "Puesta a tierra", "Inspección / certificación", "Otros"],
    // Tipos de servicio por empresa ("Otros" pide especificar)
    tipos_servicio: {
      lafken: ["Desratización", "Desinfección", "Desinsectación", "Otros"],
      omega: ["Mantención", "Instalación", "Revisión", "Otros"],
    },
  },
};
