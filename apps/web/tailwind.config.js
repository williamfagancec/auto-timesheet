/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Enhanced Design System Colors
        bg: {
          primary: '#ffffff',
          secondary: '#f8f9fa',
          hover: '#f0f4f8',
          selected: '#e3f2fd',
          glass: 'rgba(255, 255, 255, 0.8)',
        },
        text: {
          primary: '#1a202c',
          secondary: '#4a5568',
          tertiary: '#a0aec0',
        },
        border: {
          light: '#e2e8f0',
          medium: '#cbd5e0',
        },
        accent: {
          orange: '#ff6b35',
          'orange-hover': '#ff5722',
          'orange-light': '#ffb399',
          black: '#2d3748',
          purple: '#9f7aea',
          'purple-hover': '#805ad5',
          blue: '#4299e1',
          'blue-hover': '#3182ce',
          green: '#48bb78',
          'green-hover': '#38a169',
          teal: '#38b2ac',
          pink: '#ed64a6',
          yellow: '#ecc94b',
        },
        sandy: {
          DEFAULT: '#fff5eb',
          light: '#fffaf5',
          dark: '#ffe4cc',
          glow: '#ffd9b3',
        },
        gradient: {
          from: {
            orange: '#ff6b35',
            purple: '#9f7aea',
            blue: '#4299e1',
            teal: '#38b2ac',
            pink: '#ed64a6',
          },
          to: {
            orange: '#ff5722',
            purple: '#805ad5',
            blue: '#3182ce',
            teal: '#319795',
            pink: '#d53f8c',
          },
        },
        // Keep legacy colors for backwards compatibility
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #ff6b35 0%, #ff5722 100%)',
        'gradient-purple': 'linear-gradient(135deg, #9f7aea 0%, #805ad5 100%)',
        'gradient-blue': 'linear-gradient(135deg, #4299e1 0%, #3182ce 100%)',
        'gradient-teal': 'linear-gradient(135deg, #38b2ac 0%, #319795 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #ff6b35 0%, #ed64a6 100%)',
        'gradient-ocean': 'linear-gradient(135deg, #4299e1 0%, #38b2ac 100%)',
        'gradient-mesh': 'linear-gradient(135deg, rgba(255,107,53,0.1) 0%, rgba(159,122,234,0.1) 100%)',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['14px', { lineHeight: '1.5' }],
        base: ['15px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.5' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['28px', { lineHeight: '1.3' }],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        md: '0 2px 8px rgba(0, 0, 0, 0.08)',
        lg: '0 4px 16px rgba(0, 0, 0, 0.12)',
        xl: '0 8px 24px rgba(0, 0, 0, 0.15)',
        glow: '0 0 20px rgba(255, 107, 53, 0.3)',
        'glow-purple': '0 0 20px rgba(159, 122, 234, 0.3)',
        'glow-blue': '0 0 20px rgba(66, 153, 225, 0.3)',
        inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
        'fade-in-down': 'fadeInDown 0.6s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.4s ease-out',
        'slide-in-left': 'slideInLeft 0.4s ease-out',
        'bounce-subtle': 'bounceSubtle 0.6s ease-in-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'success': 'success 0.6s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 20px rgba(255, 107, 53, 0.3)' },
          '50%': { opacity: '0.8', boxShadow: '0 0 30px rgba(255, 107, 53, 0.5)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
        success: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
