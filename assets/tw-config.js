/* Tailwind play-CDN config: normalises radius/shadow/fonts site-wide to the "Monokrom Premium"
 * design (see DESIGN.md). Load right after the Tailwind CDN script. */
window.tailwind = window.tailwind || {};
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['"Barlow Semi Condensed"', 'Barlow', 'ui-sans-serif', 'sans-serif'],
        mono: ['Barlow', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '4px', DEFAULT: '6px', md: '6px', lg: '8px', xl: '12px', '2xl': '12px', '3xl': '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(1,2,5,.06)', DEFAULT: '0 2px 8px rgba(1,2,5,.08)', md: '0 2px 10px rgba(1,2,5,.08)',
        lg: '0 6px 20px rgba(1,2,5,.10)', xl: '0 10px 30px rgba(1,2,5,.12)', '2xl': '0 16px 40px rgba(1,2,5,.16)',
      },
      colors: {
        paper: 'var(--paper)', surface: 'var(--surface)', ink: 'var(--ink)', 'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)', line: 'var(--line)', tile: 'var(--tile)', brand: 'var(--brand)', accent: 'var(--accent)',
      },
    },
  },
};
