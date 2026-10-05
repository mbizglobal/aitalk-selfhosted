import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

const SUPPORTED_LANGS = ['en', 'de', 'de-ch', 'fr', 'ko'] as const;

export default async function RootPage() {
  const cookieStore = await cookies();
  const preferred = cookieStore.get('preferred-language')?.value;
  const lang = SUPPORTED_LANGS.includes(preferred as any) ? preferred! : 'en';
  redirect(`/${lang}`);
}
