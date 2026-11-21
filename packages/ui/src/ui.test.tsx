import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MESSAGE_STATUSES } from '@sampledge/contracts';
import {
  Avatar,
  Button,
  ConnectivityIndicator,
  MessageStatusIcon,
  StateView,
  ThemePicker,
  ThemeProvider,
  THEME_STORAGE_KEY,
  initials,
} from './index.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider', () => {
  it('defaults to Midnight Executive and persists the chosen theme', async () => {
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('midnight-executive');
    await userEvent.click(screen.getByRole('radio', { name: /Arctic Professional/ }));
    expect(document.documentElement.dataset.theme).toBe('arctic-professional');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('arctic-professional');
  });

  it('restores a persisted theme on mount', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'royal-graphite');
    await act(async () => {
      render(
        <ThemeProvider>
          <span />
        </ThemeProvider>,
      );
    });
    expect(document.documentElement.dataset.theme).toBe('royal-graphite');
  });

  it('applies brand colors as inline variables for the custom theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'custom-brand');
    localStorage.setItem(
      'sampledge.brand',
      JSON.stringify({ primary: '#E11D48', secondary: '#F59E0B', mode: 'dark' }),
    );
    await act(async () => {
      render(
        <ThemeProvider>
          <span />
        </ThemeProvider>,
      );
    });
    expect(document.documentElement.style.getPropertyValue('--sc-color-accent')).not.toBe('');
  });
});

describe('MessageStatusIcon', () => {
  it.each(MESSAGE_STATUSES)('has an accessible label for %s', (s) => {
    render(<MessageStatusIcon status={s} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBeTruthy();
  });
  it('never labels a queued message as sent', () => {
    render(<MessageStatusIcon status="queued" />);
    expect(screen.getByRole('img', { name: /queued/i })).toBeInTheDocument();
  });
});

describe('components', () => {
  it('loading buttons are disabled and busy', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('connectivity indicator announces queued count', () => {
    render(<ConnectivityIndicator state="offline" queued={3} />);
    expect(screen.getByRole('status', { name: 'Offline, 3 queued' })).toBeInTheDocument();
  });
  it('state view renders error as alert', () => {
    render(<StateView state="error" description="Try again" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
  it('avatar initials', () => {
    expect(initials('Priya Raman Shah')).toBe('PS');
    render(<Avatar name="Ravi Kumar" presence="online" />);
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });
});
