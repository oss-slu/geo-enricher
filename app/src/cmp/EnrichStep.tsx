// EnrichStep.tsx
import { useState } from 'react';

export default function EnrichStep({ geocodeDone, acsDone, acsStale, busy, onEnrich }: {
    geocodeDone: boolean;
    acsDone: boolean;
    acsStale: boolean;
    busy: boolean;
    onEnrich: (opts: { geo: boolean; acs: boolean }) => void;
}) {
    const [geo, setGeo] = useState(true);
    const [acs, setAcs] = useState(true);

    const useGeo = geo && geocodeDone;
    const useAcs = acs && acsDone && !acsStale;

    return (
        <div className="enricher">
            <div className="boxes">
                <label className="geo">
                    <input type="checkbox" checked={useGeo} disabled={!geocodeDone}
                           onChange={(e) => setGeo(e.target.checked)} />
                    Geocode data
                </label>
                <label className="acs">
                    <input type="checkbox" checked={useAcs} disabled={!acsDone || acsStale}
                           onChange={(e) => setAcs(e.target.checked)} />
                    ACS data
                </label>
            </div>
            <button type="button" disabled={busy || (!useGeo && !useAcs)}
                    onClick={() => onEnrich({ geo: useGeo, acs: useAcs })}>
                {busy ? 'Enriching…' : 'Enrich and download'}
            </button>
        </div>
    );
}