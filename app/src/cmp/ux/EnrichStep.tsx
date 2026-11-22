import { useEffect, useState } from 'react';

type EnrichStepProps = {
    geocodeDone: boolean;
    acsDone: boolean;
    acsStale: boolean;
    busy: boolean;
    disabled?: boolean;
    fileName: string | null;
    onEnrich: (opts: { geo: boolean; acs: boolean; outputName: string }) => void;
};

export default function EnrichStep({
    geocodeDone,
    acsDone,
    acsStale,
    busy,
    disabled = busy,
    fileName,
    onEnrich
}: EnrichStepProps) {
    const [geo, setGeo] = useState(true);
    const [acs, setAcs] = useState(true);
    const [outputName, setOutputName] = useState('');

    useEffect(() => {
        if (fileName) {
            const originalName = fileName
                .replace(/\.[^.]+$/, '')
                .replace(/\s+/g, '_');

            setOutputName(originalName);
        } else {
            setOutputName('');
        }
    }, [fileName]);

    const useGeo = geo && geocodeDone;
    const useAcs = acs && acsDone && !acsStale;

    return (
        <div className="enrich">
            <div className="boxes">
                <label className="geo">
                    <input
                        type="checkbox"
                        checked={useGeo}
                        disabled={!geocodeDone}
                        onChange={(e) => setGeo(e.target.checked)}
                    />
                    Geocoder data
                </label>

                <label className="acs">
                    <input
                        type="checkbox"
                        checked={useAcs}
                        disabled={!acsDone || acsStale}
                        onChange={(e) => setAcs(e.target.checked)}
                    />
                    ACS data
                </label>
            </div>

            <label>
                Name for enriched file:
                <input
                    type="text"
                    value={outputName}
                    disabled={disabled}
                    onChange={(e) => setOutputName(e.target.value)}
                    placeholder="Enter a filename"
                />
            </label>

            <p>The timestamp and original file extension will be added automatically.</p>

            <button
                type="button"
                disabled={disabled || (!useGeo && !useAcs) || !outputName.trim()}
                onClick={() => onEnrich({
                    geo: useGeo,
                    acs: useAcs,
                    outputName: outputName.trim()
                })}
            >
                {busy ? 'Enriching…' : 'Enrich and download'}
            </button>
        </div>
    );
}