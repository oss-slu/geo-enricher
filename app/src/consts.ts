export const DATA_SOURCE_OPTIONS = ['File Upload'] as const;

export type DataSource = (typeof DATA_SOURCE_OPTIONS)[number];

export const TABLE_IDS = [
    'b02001',
    'b03003',
    'b08201',
    'b08202',
    'b09002',
    'b11012',
    'b14003',
    'b15003',
    'b15012',
    'b16007',
    'b24030',
    'b25003',
    'b25061',
    'b25075',
    'b25024',
];

export const PREVIEW_LIMIT = 5;

export const URLS = {
    OSS_URL: "https://oss-slu.github.io/",
    OSS_IMG: "https://oss-slu.github.io/img/navbar-logo-2.png",
    SRC_URL: "https://github.com/oss-slu/geo-enricher",
    GH_IMG: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c2/GitHub_Invertocat_Logo.svg/250px-GitHub_Invertocat_Logo.svg.png?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail",
};