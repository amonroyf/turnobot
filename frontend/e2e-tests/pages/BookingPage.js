// Page Object Model para el flujo de reserva del cliente.
// Encapsula selectores y acciones para que los specs sean legibles y mantenibles.
export class BookingPage {
  constructor(page) {
    this.page = page;
  }

  async goto(slug) {
    await this.page.goto(`/shop/${slug}`);
  }

  async seleccionarServicio(nombre) {
    await this.page.getByText(nombre).first().click();
  }

  async seleccionarEmpleado(nombre) {
    const btn = this.page.getByText(nombre);
    if (await btn.count()) await btn.first().click();
  }

  async seleccionarFecha(dia) {
    await this.page.getByText(dia, { exact: false }).first().click();
  }

  async seleccionarHora(hora) {
    await this.page.getByText(hora, { exact: true }).first().click();
  }

  async fillCliente({ nombre, telefono }) {
    await this.page.getByPlaceholder(/Tu Nombre completo/i).fill(nombre);
    await this.page.getByPlaceholder(/Tu WhatsApp/i).fill(telefono);
  }

  async confirmar() {
    await this.page.getByRole('button', { name: /Confirmar Reserva/i }).click();
  }

  async mensajeExito() {
    return this.page.getByText(/¡Cita confirmada!/i);
  }
}