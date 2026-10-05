import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    let countryCode = 'US';
    let source = 'fallback';
    let detectedLanguage = 'en';

    // Try Azure Front Door headers first (production)
    const azureGeoCountry = request.headers.get('x-azure-geo-country');
    if (azureGeoCountry) {
      countryCode = azureGeoCountry;
      source = 'azure-frontdoor';
    } else {
      // Fallback: Use Accept-Language for local development
      const acceptLanguage = request.headers.get('accept-language') || '';
      if (acceptLanguage.includes('ko')) countryCode = 'KR';
      else if (acceptLanguage.includes('de')) countryCode = 'DE';
      else if (acceptLanguage.includes('fr')) countryCode = 'FR';
      else if (acceptLanguage.includes('en-GB')) countryCode = 'GB';
      source = 'accept-language';
    }

    // For local testing - allow manual override via query param
    const manualCountry = request.nextUrl.searchParams.get('country');
    if (manualCountry) {
      countryCode = manualCountry.toUpperCase();
      source = 'manual-override';
    }

    const germanCountries = ['DE', 'AT', 'LU'];
    const swissGermanCountries = ['CH', 'LI'];

    const frenchCountries = ['FR', 'BE', 'MC', 'LU', 'CH', 'CA'];

    const koreanCountries = ['KR'];

    if (koreanCountries.includes(countryCode)) {
      detectedLanguage = 'ko';
    } else if (swissGermanCountries.includes(countryCode)) {
      detectedLanguage = 'de-ch';
    } else if (germanCountries.includes(countryCode)) {
      detectedLanguage = 'de';
    } else if (frenchCountries.includes(countryCode)) {
      detectedLanguage = 'fr';
    } else {
      detectedLanguage = 'en';
    }

    if (countryCode === 'CH' || countryCode === 'LI') {
      const acceptLanguage = request.headers.get('accept-language') || '';
      if (acceptLanguage.includes('fr')) {
        detectedLanguage = 'fr';
      } else if (acceptLanguage.includes('it')) {
        detectedLanguage = 'en';
      } else {
        detectedLanguage = 'de-ch';
      }
    }

    if (countryCode === 'CA') {
      const acceptLanguage = request.headers.get('accept-language') || '';
      if (acceptLanguage.includes('fr')) {
        detectedLanguage = 'fr';
      } else {
        detectedLanguage = 'en';
      }
    }

    if (countryCode === 'BE') {
      const acceptLanguage = request.headers.get('accept-language') || '';
      if (acceptLanguage.includes('nl')) {
        detectedLanguage = 'en';
      } else if (acceptLanguage.includes('de')) {
        detectedLanguage = 'de';
      } else {
        detectedLanguage = 'fr';
      }
    }

    if (countryCode === 'LU') {
      const acceptLanguage = request.headers.get('accept-language') || '';
      if (acceptLanguage.includes('de')) {
        detectedLanguage = 'de';
      } else if (acceptLanguage.includes('fr')) {
        detectedLanguage = 'fr';
      } else {
        detectedLanguage = 'en';
      }
    }

    return NextResponse.json({
      language: detectedLanguage,
      countryCode,
      source,
      headers: {
        azureGeoCountry: azureGeoCountry || 'none',
        acceptLanguage: request.headers.get('accept-language') || 'none'
      }
    });

  } catch (error) {
    console.error('Language detection error:', error);
    return NextResponse.json({
      language: 'en',
      countryCode: 'US',
      source: 'fallback'
    });
  }
}