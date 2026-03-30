import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PERMISSIONS_GRANTED_KEY = '@permissions_granted_v1';

export default function PermissionsScreen() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);

    const handleGrant = async () => {
        setIsLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status === 'granted') {
                await AsyncStorage.setItem(PERMISSIONS_GRANTED_KEY, 'true');
                router.replace('/(tabs)');
            } else {
                Alert.alert(
                    'Permission Required',
                    'Swipe to Wipe needs access to your photos to help you clean your gallery. Please enable it in Settings.',
                    [{ text: 'OK' }]
                );
            }
        } catch (err) {
            console.error('Permission error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={s.container}>
            <LinearGradient colors={['#fff0f5', '#ffffff']} style={StyleSheet.absoluteFill} />

            <View style={s.content}>
                <Animated.View entering={FadeInDown.delay(200).duration(800)} style={s.iconCircle}>
                    <Ionicons name="images" size={50} color="#ff6b6b" />
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(400).duration(800)} style={s.textContainer}>
                    <Text style={s.title}>One last step! 📸</Text>
                    <Text style={s.description}>
                        To start cleaning your gallery, we need your permission to view and organize your photos.
                        Your privacy is our priority—we only see what you swipe.
                    </Text>
                </Animated.View>

                <Animated.View entering={FadeInUp.delay(600).duration(800)} style={s.footer}>
                    <Pressable style={s.button} onPress={handleGrant} disabled={isLoading}>
                        <LinearGradient
                            colors={['#ff6b6b', '#ff8e53']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={s.buttonGrad}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Text style={s.buttonTxt}>Allow Access</Text>
                                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                                </>
                            )}
                        </LinearGradient>
                    </Pressable>
                    <Text style={s.hint}>You can change this anytime in system settings.</Text>
                </Animated.View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    iconCircle: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 32,
        shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5,
    },
    textContainer: { alignItems: 'center' },
    title: { fontSize: 32, fontFamily: 'Syne_800ExtraBold', color: '#1f2937', textAlign: 'center', marginBottom: 16 },
    description: { fontSize: 16, fontFamily: 'DMSans_500Medium', color: '#6b7280', textAlign: 'center', lineHeight: 26 },
    footer: { width: '100%', marginTop: 60, alignItems: 'center' },
    button: { width: '100%', borderRadius: 100, overflow: 'hidden', shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
    buttonGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 12 },
    buttonTxt: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#fff' },
    hint: { fontSize: 13, fontFamily: 'DMSans_500Medium', color: '#9ca3af', marginTop: 16 },
});
