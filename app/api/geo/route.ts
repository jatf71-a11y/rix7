import { NextRequest, NextResponse } from 'next/server';
import { findLocation, findNearestChileLocation } from '@/lib/data/chileLocations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // 1. Headers de Vercel Edge en producción
    const vercelCity = request.headers.get('x-vercel-ip-city');
    const vercelLatStr = request.headers.get('x-vercel-ip-latitude');
    const vercelLngStr = request.headers.get('x-vercel-ip-longitude');
    const forwardedFor = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');

    let clientLat = vercelLatStr ? parseFloat(vercelLatStr) : null;
    let clientLng = vercelLngStr ? parseFloat(vercelLngStr) : null;
    let cityName = vercelCity ? decodeURIComponent(vercelCity) : null;

    // 2. Si tenemos coordenadas de Vercel Edge
    if (clientLat !== null && clientLng !== null && !isNaN(clientLat) && !isNaN(clientLng)) {
      const nearest = findNearestChileLocation(clientLat, clientLng);
      return NextResponse.json({
        success: true,
        source: 'vercel_edge',
        city: cityName || nearest.communeName,
        communeName: nearest.communeName,
        regionName: nearest.regionName,
        regionCode: nearest.regionCode,
        lat: nearest.lat,
        lng: nearest.lng,
        zoom: nearest.zoom,
        distanceKm: nearest.distanceKm,
      });
    }

    // 3. Si tenemos nombre de ciudad desde Vercel
    if (cityName) {
      const found = findLocation(cityName);
      if (found) {
        return NextResponse.json({
          success: true,
          source: 'vercel_city',
          city: found.name,
          communeName: found.type === 'commune' ? found.name : undefined,
          regionName: found.regionName,
          lat: found.lat,
          lng: found.lng,
          zoom: found.zoom,
        });
      }
    }

    // 4. Si estamos en local dev o falta info de Vercel, probar lookup por IP desde el servidor
    let ip = forwardedFor ? forwardedFor.split(',')[0].trim() : '';
    const isPrivateIp = !ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');

    if (!isPrivateIp) {
      try {
        const ipRes = await fetch(`https://ipwho.is/${ip}`, { next: { revalidate: 3600 } });
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          if (ipData.success && typeof ipData.latitude === 'number' && typeof ipData.longitude === 'number') {
            const nearest = findNearestChileLocation(ipData.latitude, ipData.longitude);
            return NextResponse.json({
              success: true,
              source: 'ip_lookup',
              city: ipData.city || nearest.communeName,
              communeName: nearest.communeName,
              regionName: nearest.regionName,
              regionCode: nearest.regionCode,
              lat: nearest.lat,
              lng: nearest.lng,
              zoom: nearest.zoom,
            });
          }
        }
      } catch {
        // Continuar a fallback
      }
    }

    // 5. Fallback predeterminado: Santiago centro (Plaza de Armas / Centro Cívico)
    const defaultLoc = findNearestChileLocation(-33.4425, -70.6530);
    return NextResponse.json({
      success: true,
      source: 'default',
      city: 'Santiago',
      communeName: 'Santiago',
      regionName: defaultLoc.regionName,
      regionCode: defaultLoc.regionCode,
      lat: defaultLoc.lat,
      lng: defaultLoc.lng,
      zoom: 13,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'Error detecting location',
      city: 'Santiago',
      lat: -33.4425,
      lng: -70.6530,
      zoom: 13,
    }, { status: 500 });
  }
}
