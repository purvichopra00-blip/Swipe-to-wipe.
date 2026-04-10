import { Tabs, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Platform, Pressable, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePhotos } from '../../contexts/PhotoContext';
import { useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_COMPLETED_KEY } from '../onboarding';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const { width: W } = Dimensions.get('window');
const TAB_WIDTH = (W - 48) / 2;

function TabIcon({ name, color, focused, count, onPress }: { name: string, color: string, focused: boolean, count?: number, onPress: () => void }) {
    const scale = useSharedValue(1);

    useEffect(() => {
        scale.value = withSpring(focused ? 1.2 : 1, { damping: 12, stiffness: 200 });
    }, [focused]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return (
        <Pressable onPress={onPress} style={styles.iconWrap}>
            <Animated.View style={[styles.iconContainer, animatedStyle]}>
                <Ionicons name={name as any} size={24} color={color} />
                {(count ?? 0) > 0 && (
                    <View style={styles.dot}>
                        <View style={styles.dotInner} />
                    </View>
                )}
            </Animated.View>
        </Pressable>
    );
}

export default function TabLayout() {
    const { binPhotos } = usePhotos();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const indicatorPos = useSharedValue(0);

    useFocusEffect(
        useCallback(() => {
            AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY).then(res => {
                if (res !== 'true') router.replace('/onboarding');
            });
        }, [router])
    );

    const indicatorStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: indicatorPos.value }],
    }));

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: { display: 'none' }, // Hide default, we use custom
                tabBarActiveTintColor: '#ff6b6b',
                tabBarInactiveTintColor: '#9ca3af',
            }}
            tabBar={(props) => {
                const { state, navigation, descriptors } = props;
                // Filter out screens with href: null to match our custom UI state
                const visibleRoutes = state.routes.filter(route => {
                    const { options } = descriptors[route.key];
                    return (options as any).href !== null;
                });

                return (
                    <View style={[styles.tabBarContainer, { bottom: Math.max(insets.bottom, 20) }]}>
                        <View style={styles.tabBarPill}>
                            <Animated.View style={[styles.indicator, indicatorStyle]} />
                            {visibleRoutes.map((route, index) => {
                                const { options } = descriptors[route.key];
                                const isFocused = state.index === state.routes.findIndex(r => r.key === route.key);

                                const onPress = () => {
                                    const event = navigation.emit({
                                        type: 'tabPress',
                                        target: route.key,
                                        canPreventDefault: true,
                                    });

                                    if (!isFocused && !event.defaultPrevented) {
                                        navigation.navigate(route.name);
                                        indicatorPos.value = withSpring(index * TAB_WIDTH, { damping: 15, stiffness: 150 });
                                    }
                                };

                                return (
                                    <TabIcon
                                        key={route.key}
                                        name={route.name === 'index' ? (isFocused ? 'home' : 'home-outline') : (isFocused ? 'trash' : 'trash-outline')}
                                        color={isFocused ? '#ff6b6b' : '#9ca3af'}
                                        focused={isFocused}
                                        onPress={onPress}
                                        count={route.name === 'bin' ? binPhotos.length : 0}
                                    />
                                );
                            })}
                        </View>
                    </View>
                );
            }}
        >
            <Tabs.Screen name="index" />
            <Tabs.Screen name="bin" />
        </Tabs>
    );
}

const styles = StyleSheet.create({
    tabBarContainer: {
        position: 'absolute',
        // bottom is dynamic
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabBarPill: {
        width: W - 48,
        height: 64,
        backgroundColor: '#ffffff',
        borderRadius: 32,
        flexDirection: 'row',
        elevation: 12,
        shadowColor: 'rgba(0,0,0,0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 20,
        overflow: 'hidden',
    },
    indicator: {
        position: 'absolute',
        top: 8,
        left: 8,
        width: TAB_WIDTH - 16,
        height: 48,
        backgroundColor: 'rgba(255,107,107,0.08)',
        borderRadius: 24,
    },
    iconWrap: {
        flex: 1,
        height: 64,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dot: {
        position: 'absolute', top: -2, right: -6,
        width: 10, height: 10, borderRadius: 5,
        backgroundColor: '#ffffff',
        alignItems: 'center', justifyContent: 'center',
    },
    dotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
});
