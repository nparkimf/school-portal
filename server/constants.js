export const STATES = ['VA', 'DC', 'MD'];

export const LEVELS = ['Pre-K', 'Elementary', 'Middle', 'High'];

export const SCHOOL_TYPES = [
  'Independent',
  'Religious',
  'Montessori',
  'Special Education',
  'Boarding',
  'Other',
];

// Order matters: the first field is tuition, the rest are additional fees.
export const FEE_FIELDS = [
  { key: 'tuition', label: 'Tuition' },
  { key: 'registration_fee', label: 'Registration' },
  { key: 'application_fee', label: 'Application' },
  { key: 'technology_fee', label: 'Technology' },
  { key: 'activity_fee', label: 'Activities' },
  { key: 'books_fee', label: 'Books & Supplies' },
  { key: 'uniform_fee', label: 'Uniform' },
  { key: 'other_fee', label: 'Other' },
];

export const MAX_AMOUNT = 500000;
