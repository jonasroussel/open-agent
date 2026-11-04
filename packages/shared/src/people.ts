/** People have only an email: the part before the @ names them ("marie.dupont@gmail.com" gives "marie.dupont"). */
export function personNameOf(email: string): string {
  return email.split('@')[0] || email;
}
