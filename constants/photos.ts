export interface Photo {
    id: string;
    url: string;
    title?: string;
    photographer?: string;
    category?: string;
    filename?: string;
    mediaType?: string;
    creationTime?: number;
    fileSize?: number;
    width?: number;
    height?: number;
}

export const PHOTOS: Photo[] = [
    {
        id: '1',
        url: 'https://picsum.photos/id/1015/800/1200',
        title: 'Mountain River',
        photographer: 'Alejandro Escamilla',
        category: 'Nature',
    },
    {
        id: '2',
        url: 'https://picsum.photos/id/1016/800/1200',
        title: 'Snowy Peaks',
        photographer: 'Philippe Wuyts',
        category: 'Nature',
    },
    {
        id: '3',
        url: 'https://picsum.photos/id/1018/800/1200',
        title: 'Misty Forest',
        photographer: 'Andrew Ridley',
        category: 'Nature',
    },
    {
        id: '4',
        url: 'https://picsum.photos/id/1019/800/1200',
        title: 'Coastal Sunset',
        photographer: 'Patrick Tomasso',
        category: 'Landscape',
    },
    {
        id: '5',
        url: 'https://picsum.photos/id/1022/800/1200',
        title: 'City Lights',
        photographer: 'Giu Vicente',
        category: 'Urban',
    },
    {
        id: '6',
        url: 'https://picsum.photos/id/1025/800/1200',
        title: 'Happy Pug',
        photographer: 'Charles Deluvio',
        category: 'Animals',
    },
    {
        id: '7',
        url: 'https://picsum.photos/id/1029/800/1200',
        title: 'Open Road',
        photographer: 'Caleb George',
        category: 'Travel',
    },
    {
        id: '8',
        url: 'https://picsum.photos/id/1035/800/1200',
        title: 'Night Architecture',
        photographer: 'Jared Erondu',
        category: 'Urban',
    },
    {
        id: '9',
        url: 'https://picsum.photos/id/1036/800/1200',
        title: 'Autumn Leaves',
        photographer: 'Wolfgang Lutz',
        category: 'Nature',
    },
    {
        id: '10',
        url: 'https://picsum.photos/id/1039/800/1200',
        title: 'Lakeside Dawn',
        photographer: 'Luca Bravo',
        category: 'Landscape',
    },
    {
        id: '11',
        url: 'https://picsum.photos/id/1043/800/1200',
        title: 'Desert Dunes',
        photographer: 'Christian Bardenhorst',
        category: 'Nature',
    },
    {
        id: '12',
        url: 'https://picsum.photos/id/1047/800/1200',
        title: 'Wildflowers',
        photographer: 'Roksolana Zasiadko',
        category: 'Nature',
    },
    {
        id: '13',
        url: 'https://picsum.photos/id/1050/800/1200',
        title: 'Golden Hour',
        photographer: 'Joe Gardner',
        category: 'Landscape',
    },
    {
        id: '14',
        url: 'https://picsum.photos/id/1052/800/1200',
        title: 'Ocean Waves',
        photographer: 'Annie Spratt',
        category: 'Nature',
    },
    {
        id: '15',
        url: 'https://picsum.photos/id/1059/800/1200',
        title: 'Mountain Magic',
        photographer: 'Jason Ortego',
        category: 'Nature',
    },
];
