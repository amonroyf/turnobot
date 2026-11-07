export const CATALOGO_PRUEBAS = {
  TestMisCitasMismoMinuto: {
    categoria: "Paginación & Concurrencia",
    colorCategoria: "#2563eb",
    etiquetas: [
      { nombre: "Paginación por Cursor", color: "#3b82f6", definicion: "Técnica donde la siguiente página se consulta usando el valor del último registro (fecha + ID) en vez de un OFFSET numérico. Evita saltar o repetir registros si entran datos nuevos en tiempo real." },
      { nombre: "Tie-Breaking (Desempate)", color: "#6366f1", definicion: "Criterio de ordenamiento secundario (por DocumentID) cuando dos registros tienen exactamente la misma fecha y hora." },
      { nombre: "Lectura No Bloqueante", color: "#0ea5e9", definicion: "Consultas de solo lectura que no generan contención ni bloqueos de transacciones en la base de datos." }
    ],
    reglaNegocio: "Reservas múltiples en el mismo minuto",
    explicacionRegla: "Permite que un cliente o grupo agende varias citas en el mismo bloque horario (ej. una cancha y un servicio individual) sin que la paginación de 'Mis Citas' se vuelva loca ni oculte registros.",
    porQueImporta: "Evita bugs silenciosos donde un cliente no ve todas sus citas en su teléfono porque dos citas comparten el mismo minuto."
  },

  TestCupoLlenoSoldOut: {
    categoria: "Integridad de Datos",
    colorCategoria: "#dc2626",
    etiquetas: [
      { nombre: "HTTP 409 Conflict", color: "#ef4444", definicion: "Código HTTP que indica que la petición no pudo procesarse debido a un choque con el estado actual del recurso (en este caso, que los cupos se agotaron)." },
      { nombre: "Transacción Atómica", color: "#b91c1c", definicion: "Operación de base de datos que se ejecuta bajo el principio de 'todo o nada'. Si dos usuarios reservan el último cupo al tiempo, solo uno entra y el otro hace rollback." },
      { nombre: "Capacidad Efectiva", color: "#f97316", definicion: "Cálculo real de puestos disponibles restando cancelaciones activas del cupo total del espacio." }
    ],
    reglaNegocio: "Tope máximo de cupos en clases y espacios",
    explicacionRegla: "Cuando una clase o espacio (ej. funcional, box o cancha) alcanza su límite de capacidad configurado, el sistema rechaza cualquier reserva adicional de forma inmediata.",
    porQueImporta: "Protege al negocio contra la sobreventa (overbooking) y asegura que nunca lleguen más personas de las que caben físicamente."
  },

  TestCanMarkNoShow: {
    categoria: "Reglas Temporales",
    colorCategoria: "#d97706",
    etiquetas: [
      { nombre: "Validación Temporal", color: "#f59e0b", definicion: "Regla que compara una marca de tiempo (timestamp) contra la hora actual del servidor (time.Now())." },
      { nombre: "Protección de Historial", color: "#b45309", definicion: "Principio de diseño donde los estados pasados son inmutables o solo se modifican bajo acciones específicas de auditoría." }
    ],
    reglaNegocio: "No-Show solo en citas pasadas",
    explicacionRegla: "Un empleado o dueño solo puede marcar como 'No Asistió' una cita cuya hora ya pasó o está en curso. Está estrictamente prohibido marcar inasistencia a futuro.",
    porQueImporta: "Evita fraudes y errores humanos donde el personal cancela citas por adelantado afectando la tasa de asistencia del cliente."
  }
};
