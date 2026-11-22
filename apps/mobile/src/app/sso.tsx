import { router } from 'expo-router';
import { useEffect } from 'react';

/**
 * Where single sign-on returns (sampledge://sso). The sign-in screen reads the code from the
 * browser session; if the system also opens this link, step straight back.
 */
export default function SsoReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return null;
}
