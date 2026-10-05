import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getEdition } from '@/lib/edition';

export default function NotFound() {
  if (getEdition() === 'selfhosted') {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-base font-semibold text-green-600">404</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">Page not found</h1>
          <Link href="/app" className="mt-8 inline-block rounded-md bg-green-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-green-500">
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow flex items-center justify-center px-6 py-24 sm:py-32 lg:px-8">
        <div className="text-center">
          <p className="text-base font-semibold text-green-600">404</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Page not found
          </h1>
          <p className="mt-6 text-base leading-7 text-gray-600">
            Sorry, we couldn't find the page you're looking for.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-4">
            <Link
              href="/en"
              className="rounded-md bg-green-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
            >
              Go back home
            </Link>
            <Link
              href="/blog"
              className="text-sm font-semibold text-gray-900 hover:text-green-600"
            >
              Visit our blog <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/en/mbizglobal"
              className="text-sm font-semibold text-gray-900 hover:text-green-600"
            >
              About us <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="mt-16 p-4 bg-gray-50 rounded-lg max-w-2xl mx-auto">
            <p className="text-sm text-gray-600">
              <strong>Were you looking for:</strong>
            </p>
            <ul className="mt-2 text-sm text-gray-600 text-left list-disc list-inside">
              <li>Homepage: <Link href="/en" className="text-green-600 hover:underline">www.aitalk.ch/en</Link></li>
              <li>Blog: <Link href="/blog" className="text-green-600 hover:underline">www.aitalk.ch/blog</Link></li>
              <li>Company: <Link href="/en/mbizglobal" className="text-green-600 hover:underline">www.aitalk.ch/en/mbizglobal</Link></li>
              <li>Legal documents: <Link href="/en/law/privacy-policy" className="text-green-600 hover:underline">www.aitalk.ch/en/law/privacy-policy</Link></li>
            </ul>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
