import { useState } from 'react';

type EnrichStepProps = {
    geocodeDone: boolean;
    acsDone: boolean;
    acsStale: boolean;
    busy: boolean;
    disabled?: boolean; // true while any step is running
    onEnrich: (opts: { geo: boolean; acs: boolean }) => void;
};

export default function EnrichStep({
    geocodeDone, acsDone, acsStale, busy, disabled = busy, onEnrich }: EnrichStepProps
) {
    const [geo, setGeo] = useState(true);
    const [acs, setAcs] = useState(true);

    const useGeo = geo && geocodeDone;
    const useAcs = acs && acsDone && !acsStale;

    return (
        <div className="enrich">
            <div className="boxes">
                <label className="geo">
                    <input type="checkbox" checked={useGeo} disabled={!geocodeDone}
                           onChange={(e) => setGeo(e.target.checked)} />
                    Geocoder data
                </label>
                <label className="acs">
                    <input type="checkbox" checked={useAcs} disabled={!acsDone || acsStale}
                           onChange={(e) => setAcs(e.target.checked)} />
                    ACS data
                </label>
            </div>
            <button type="button" disabled={disabled || (!useGeo && !useAcs)}
                    onClick={() => onEnrich({ geo: useGeo, acs: useAcs })}>
                {busy ? 'Enriching…' : 'Enrich and download'}
            </button>
        </div>
    );
}