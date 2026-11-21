import { describe, expect, it } from 'vitest';
import {
  base64Bytes,
  profileChanges,
  profileProblem,
  squareCrop,
  type ProfileForm,
} from './profile';

const form = (over: Partial<ProfileForm> = {}): ProfileForm => ({
  displayName: 'Sam Patel',
  title: 'Analyst',
  department: '',
  phone: '',
  bio: '',
  timeZone: 'Asia/Kolkata',
  ...over,
});

describe('profile form', () => {
  it('sends only changed fields, trimmed, and "" to clear one', () => {
    expect(profileChanges(form(), form())).toEqual({});
    expect(
      profileChanges(form(), form({ title: '', department: ' Field ops ', bio: 'Hi' })),
    ).toEqual({ title: '', department: 'Field ops', bio: 'Hi' });
  });

  it('checks the server rules before queueing', () => {
    expect(profileProblem(form())).toBeNull();
    expect(profileProblem(form({ displayName: '  ' }))).toMatch(/name/);
    expect(profileProblem(form({ phone: '+91 (22) 555-0100' }))).toBeNull();
    expect(profileProblem(form({ phone: 'call me' }))).toMatch(/digits/);
    expect(profileProblem(form({ timeZone: 'Mars/Olympus' }))).toMatch(/not a time zone/);
  });

  it('crops the centred square and measures base64 size', () => {
    expect(squareCrop(4000, 3000)).toEqual({ originX: 500, originY: 0, width: 3000, height: 3000 });
    expect(squareCrop(1080, 1920)).toEqual({ originX: 0, originY: 420, width: 1080, height: 1080 });
    expect(base64Bytes(btoa('abcd'))).toBe(4);
    expect(base64Bytes(btoa('abcde'))).toBe(5);
  });
});
