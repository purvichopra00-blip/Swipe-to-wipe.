import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';

export async function testFileSize() {
    console.log('Testing file size...');
    const result = await MediaLibrary.getAssetsAsync({ first: 1 });
    if (result.assets.length > 0) {
        const asset = result.assets[0];
        console.log('Asset:', asset);
        try {
            const info = await MediaLibrary.getAssetInfoAsync(asset.id);
            console.log('Asset Info:', JSON.stringify(info, null, 2));
            const uri = info.localUri || info.uri;
            console.log('Checking URI:', uri);
            const fi = await FileSystem.getInfoAsync(uri);
            console.log('File Info:', fi);
        } catch (e) {
            console.error('Error:', e);
        }
    }
}
