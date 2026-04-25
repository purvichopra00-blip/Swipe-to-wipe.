import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Alert, StatusBar } from 'react-native';
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
            <StatusBar barStyle="dark-content" />
            <View style={s.content}>
                <Animated.View entering={FadeInDown.delay(200).duration(800)} style={s.header}>
                    <View style={s.iconCircle}>
                        <Ionicons name="images" size={44} color="#FF6B6B" />
                    </View>
                    <Text style={s.title}>Let’s clean your gallery</Text>
                    <Text style={s.description}>
                        We need access to show your photos.
                    </Text>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(400).duration(800)} style={s.trustBadge}>
                    <Ionicons name="shield-checkmark" size={16} color="#22C55E" />
                    <Text style={s.trustText}>Processed on your device</Text>
                </Animated.View>

                <Animated.View entering={FadeInUp.delay(600).duration(800)} style={s.footer}>
                    <Pressable 
                        style={({ pressed }) => [
                            s.button, 
                            pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }
                        ]} 
                        onPress={handleGrant} 
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={s.buttonTxt}>Allow Access →</Text>
                        )}
                    </Pressable>
                </Animated.View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FAFAFA' },
    content: { flex: 1, paddingHorizontal: 40, justifyContent: 'center', alignItems: 'center' },
    header: { alignItems: 'center', marginBottom: 40 },
    iconCircle: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: '#FFF1F1',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 32,
    },
    title: { 
        fontSize: 34, 
        fontFamily: 'System', 
        color: '#1C1C1E', 
        fontWeight: '800', 
        textAlign: 'center', 
        marginBottom: 12,
        letterSpacing: -1,
    },
    description: { 
        fontSize: 18, 
        fontFamily: 'DMSans_400Regular', 
        color: '#6B7280', 
        textAlign: 'center', 
        lineHeight: 24,
        fontWeight: '500',
    },
    trustBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 100,
        gap: 8,
        marginBottom: 60,
    },
    trustText: {
        fontSize: 13,
        color: '#4B5563',
        fontWeight: '600',
    },
    footer: { width: '100%', alignItems: 'center' },
    button: { 
        width: '100%', 
        backgroundColor: '#FF6B6B',
        borderRadius: 18, 
        paddingVertical: 20, 
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#FF6B6B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 8,
    },
    buttonTxt: { 
        fontSize: 18, 
        fontFamily: 'DMSans_700Bold', 
        color: '#FFFFFF', 
        fontWeight: '700',
    },
});
