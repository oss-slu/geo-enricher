import type { CSSProperties, ReactNode } from 'react';

type MenuBarProps = {
    children: ReactNode;
    gap?: number | string;
    justify?: CSSProperties['justifyContent'];
    padding?: CSSProperties['padding'];
    className?: string;
};

function MenuBar({
    children,
    gap = '1rem',
    justify = 'flex-start',
    padding = '0',
    className,
}: MenuBarProps) {
    return (
        <nav
            className={className}
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: justify,
                padding: padding,
                gap,
            }}
        >{children}</nav>
    );
}

export default MenuBar;