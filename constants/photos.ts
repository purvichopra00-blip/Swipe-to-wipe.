export interface Photo {
    id: string;
    url: string;
    mediaType: string;
    creationTime: number;
    modificationTime: number;
    duration: number;
    filename?: string;
    fileSize?: number;
}


export const PHOTOS: Photo[] = []; // Empty mock array, will be populated by MediaLibrary
