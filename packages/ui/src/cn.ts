import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-lg',
            'display',
            'h1',
            'h2',
            'h3',
            'body',
            'message',
            'label',
            'meta',
            'overline',
          ],
        },
      ],
    },
  },
});

/** shadcn/ui-style class combiner that understands Sampledge type tokens. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
