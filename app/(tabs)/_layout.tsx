import { Tabs, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Platform, Pressable, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePhotos } from '../../contexts/PhotoContext';
import { useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_COMPLETED_KEY } from '../onboarding';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withRepeat, withTiming } from 'react-native-reanimated';

const { width: W } = Dimensions.get('window');
const TAB_WIDTH = Math.max(10, (W - 48) / 3);

function PulseDot() {
    const scale = useSharedValue(0.8);
    const opacity = useSharedValue(1);

    useEffect(() => {
        scale.value = withRepeat(withTiming(1.4, { duration: 800 }), -1, true);
        opacity.value = withRepeat(withTiming(0.4, { duration: 800 }), -1, true);
    }, []);

    const style = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
        opacity: opacity.value,
    }));

    return <Animated.View style={[styles.pulseDot, style]} />;
}

function TabIcon({ name, color, focused, count, onPress, isNew }: { name: string, color: string, focused: boolean, count?: number, onPress: () => void, isNew?: boolean }) {
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
                {isNew && !focused && <PulseDot />}
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
    const { binPhotos, setShowCalendar, calendarTutorialSeen, showIntro } = usePhotos();
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
                    <View style={[
                        styles.tabBarContainer, 
                        { bottom: Math.max(insets.bottom, 20) },
                        showIntro && { display: 'none', height: 0, opacity: 0 }
                    ]}>
                        <View style={styles.tabBarPill}>
                            <Animated.View style={[styles.indicator, indicatorStyle]} />
                            {(() => {
                                const homeRoute = visibleRoutes.find(r => r.name === 'index');
                                const binRoute = visibleRoutes.find(r => r.name === 'bin');
                                
                                return [
                                    { route: homeRoute, index: 0, name: 'home' },
                                    { virtual: true, name: 'calendar', index: 1 },
                                    { route: binRoute, index: 2, name: 'trash' }
                                ].map((item, index) => {
                                    const isActive = item.virtual ? false : (state.index === (item.route?.name === 'index' ? 0 : 1));
                                    const count = item.name === 'trash' ? binPhotos.length : 0;

                                    const onPress = () => {
                                        if (item.virtual) {
                                            navigation.navigate('index');
                                            setShowCalendar(true);
                                            indicatorPos.value = withSpring(1 * TAB_WIDTH, { damping: 15, stiffness: 150 });
                                        } else if (item.route) {
                                            navigation.navigate(item.route.name);
                                            indicatorPos.value = withSpring(item.index * TAB_WIDTH, { damping: 15, stiffness: 150 });
                                        }
                                    };

                                    return (
                                        <TabIcon
                                            key={item.name}
                                            name={item.name === 'home' ? (isActive ? 'home' : 'home-outline') : 
                                                  item.name === 'calendar' ? 'calendar' :
                                                  (isActive ? 'trash' : 'trash-outline')}
                                            color={isActive ? '#ff6b6b' : '#9ca3af'}
                                            focused={isActive}
                                            onPress={onPress}
                                            count={item.name === 'trash' ? binPhotos.length : 0}
                                            isNew={item.name === 'calendar' && !calendarTutorialSeen}
                                        />
                                    );
                                });
                            })()}
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
        width: Math.max(0, TAB_WIDTH - 16),
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
    pulseDot: {
        position: 'absolute',
        top: -2,
        right: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#ff6b6b',
    },
});
