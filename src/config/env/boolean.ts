import { z } from 'zod';

export const stringBooleanSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      return value;
  }
}, z.boolean());
