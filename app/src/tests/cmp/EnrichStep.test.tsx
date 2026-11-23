
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EnrichStep from '../../cmp/ux/EnrichStep';

type Props = Parameters<typeof EnrichStep>[0];

function setup(props: Partial<Props> = {}) {
    const onEnrich = vi.fn();

    render(
        <EnrichStep
            geocodeDone
            acsDone
            acsStale={false}
            busy={false}
            fileName="input.csv"
            onEnrich={onEnrich}
            {...props}
        />,
    );

    return {
        onEnrich,
        geo: screen.getByLabelText('Geocoder data'),
        acs: screen.getByLabelText('ACS data'),
        filename: screen.getByLabelText('Name for enriched file:'),
        button: screen.getByRole('button'),
    };
}

describe('EnrichStep', () => {
    it('enriches with both sources by default', () => {
        const { onEnrich, geo, acs, button } = setup();

        expect(geo).toBeChecked();
        expect(acs).toBeChecked();

        fireEvent.click(button);

        expect(onEnrich).toHaveBeenCalledWith({
            geo: true,
            acs: true,
            outputName: 'input',
        });
    });

    it('lets either source be unchecked', () => {
        const { onEnrich, acs, button } = setup();

        fireEvent.click(acs);
        fireEvent.click(button);

        expect(onEnrich).toHaveBeenCalledWith({
            geo: true,
            acs: false,
            outputName: 'input',
        });
    });

    it('disables sources whose step has not run', () => {
        const { onEnrich, geo, acs, button } = setup({
            acsDone: false,
        });

        expect(geo).toBeEnabled();
        expect(acs).toBeDisabled();
        expect(acs).not.toBeChecked();

        fireEvent.click(button);

        expect(onEnrich).toHaveBeenCalledWith({
            geo: true,
            acs: false,
            outputName: 'input',
        });
    });

    it('excludes stale ACS data', () => {
        const { onEnrich, acs, button } = setup({
            acsStale: true,
        });

        expect(acs).toBeDisabled();
        expect(acs).not.toBeChecked();

        fireEvent.click(button);

        expect(onEnrich).toHaveBeenCalledWith({
            geo: true,
            acs: false,
            outputName: 'input',
        });
    });

    it('allows the user to edit the output filename', () => {
        const { onEnrich, filename, button } = setup();

        expect(filename).toHaveValue('input');

        fireEvent.change(filename, {
            target: { value: 'Fall_Enrollment' },
        });

        fireEvent.click(button);

        expect(onEnrich).toHaveBeenCalledWith({
            geo: true,
            acs: true,
            outputName: 'Fall_Enrollment',
        });
    });

    it('disables the button when nothing is selected', () => {
        const { geo, acs, button } = setup();

        fireEvent.click(geo);
        fireEvent.click(acs);

        expect(button).toBeDisabled();
    });

    it('disables the button when no step has run', () => {
        const { button } = setup({
            geocodeDone: false,
            acsDone: false,
        });

        expect(button).toBeDisabled();
    });

    it('disables the button when the filename is empty', () => {
        const { filename, button } = setup();

        fireEvent.change(filename, {
            target: { value: '   ' },
        });

        expect(button).toBeDisabled();
    });

    it('shows progress while enriching', () => {
        const { button } = setup({ busy: true });

        expect(button).toBeDisabled();
        expect(button).toHaveTextContent('Enriching…');
    });

    it('disables the button while another step runs', () => {
        const { button } = setup({ disabled: true });

        expect(button).toBeDisabled();
        expect(button).toHaveTextContent('Enrich and download');
    });
});
