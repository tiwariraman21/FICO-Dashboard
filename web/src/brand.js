// Who this dashboard belongs to, and who is using it.

export const LOGO = '/infrabeat-logo.png';
export const COMPANY = 'InfraBeat Technologies Pvt. Ltd.';
export const PRODUCT = 'Finance dashboard';

// The signed-in person's display name comes from the backend (AUTH_DISPLAY_NAME). This is
// the fallback and the profile shown in the account panel. In a real deployment it would
// come from the HR system and the SAP user master, not a constant.
export const APPROVER_NAME = 'Meera K';
export const USER_PROFILE = {
  role: 'Finance Controller',
  dept: 'Group finance',
  sapUser: 'MEERAK',
  location: 'Pune office, InfraBeat Technologies Pvt. Ltd.',
  reportsTo: 'Ms. Nandini Rao, Chief Financial Officer',
  limits: 'Journal entries up to ₹50 L, invoice releases up to ₹1 cr, payment runs up to ₹3 cr',
  companyCodes: '1000 Pune, 2000 Mumbai, 3000 Nagpur'
};
