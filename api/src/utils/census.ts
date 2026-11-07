
import type { censusGeocodeResp, geocodeBlockResult } from '../types/census';
import { CENSUS_GEOCODER_BASE } from '../consts';
import { getJson } from '../utils/http';
import type { requestOptions } from '../types/http';


function getExpectedLocation(address: string) {
    const match = address.match(
        /,\s*([A-Za-z]{2})\s*,?\s*(\d{5})(?:-\d{4})?\s*$/u,
    );

    if (!match) return null;

    return {
        state: match[1].toUpperCase(),
        zip: match[2],
    };
}


export async function getGeocodeFromAddr(
    address: string,
    options: requestOptions = {},
): Promise<geocodeBlockResult | null> {
    const params = new URLSearchParams({
        address,
        benchmark: 'Public_AR_Current',
        vintage: 'Current_Current',
        layers: '10',
        format: 'json',
    });

    const url = `${CENSUS_GEOCODER_BASE}?${params.toString()}`;

    const data = await getJson<censusGeocodeResp>(url, options);

    const expected = getExpectedLocation(address);

    if (!expected) return null;

    // Only accept matches whose returned location agrees with the input.
    const match = data.result.addressMatches.find((candidate) => {
        const components = candidate.addressComponents;

        if (!components?.state || !components?.zip) {
            return false;
        }

        const returnedState = components.state.trim().toUpperCase();
        const returnedZip = components.zip.trim();

        const stateMatches =
            !expected.state || returnedState === expected.state;

        const zipMatches = returnedZip === expected.zip;

        return stateMatches && zipMatches;
    });

    if (!match) return null;

    const block = match.geographies['Census Block Groups']?.[0];
    if (!block) return null;

    return {
        matchedAddress: match.matchedAddress,
        latitude: match.coordinates.y,
        longitude: match.coordinates.x,
        blockGeoid: block.GEOID,
        state: block.STATE,
        county: block.COUNTY,
        tract: block.TRACT,
        blkgrp: block.BLKGRP,
    };
}
