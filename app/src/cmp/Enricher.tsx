type enricherProps = {
    writeGeo: boolean,
    writeAcs: boolean,
    onGeoChange: (checked: boolean) => void,
    onAcsChange: (checked: boolean) => void,
};

export default function Enricher({ writeGeo, writeAcs, onGeoChange, onAcsChange }: enricherProps) {
    return (
        <div className="enricher">
            <div className="boxes">
                <label className="geo">
                    <input
                        type="checkbox"
                        checked={writeGeo}
                        onChange={(e) => onGeoChange(e.target.checked)}
                    /> Geocoder
                </label>
                <label className="acs">
                    <input
                        type="checkbox"
                        checked={writeAcs}
                        onChange={(e) => onAcsChange(e.target.checked)}
                    /> ACS
                </label>
            </div>
            <button>Enrich File</button>
        </div>
    );
}