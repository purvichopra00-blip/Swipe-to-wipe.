import React, { useState, useRef } from 'react';
import {
    StyleSheet, View, Text, TextInput, Pressable,
    Dimensions, KeyboardAvoidingView, Platform,
    TouchableWithoutFeedback, Keyboard, ActivityIndicator, Alert,
    Modal, FlatList
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { usePhotos } from '../../contexts/PhotoContext';

const { height: H } = Dimensions.get('window');

export const AUTH_TOKEN_KEY = '@auth_token_v1';

const COUNTRIES = [
    { name: 'United States', dialCode: '+1', flag: '🇺🇸' },
    { name: 'India', dialCode: '+91', flag: '🇮🇳' },
    { name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧' },
    { name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
    { name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
    { name: 'Germany', dialCode: '+49', flag: '🇩🇪' },
    { name: 'France', dialCode: '+33', flag: '🇫🇷' },
    { name: 'Japan', dialCode: '+81', flag: '🇯🇵' },
    { name: 'Singapore', dialCode: '+65', flag: '🇸🇬' },
    { name: 'UAE', dialCode: '+971', flag: '🇦🇪' },
];

export default function LoginScreen() {
    const router = useRouter();
    const { setUserToken } = usePhotos();
    
    // 1. Properly initialize the ReCaptcha Verifier ref
    const recaptchaVerifier = useRef<FirebaseRecaptchaVerifierModal>(null);
    
    const [authMode, setAuthMode] = useState<'phone' | 'otp'>('phone');
    const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[1]); // Default India
    const [isCountryModalVisible, setIsCountryModalVisible] = useState(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    
    // 2. State to hold the confirmation result needed for verification
    const [confirmationResult, setConfirmationResult] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleGuestMode = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsLoading(true);
        try {
            await AsyncStorage.setItem(AUTH_TOKEN_KEY, 'guest');
            setUserToken('guest');
            router.replace('/permissions');
        } catch (error) {
            console.error("Guest mode error:", error);
        } finally {
            setIsLoading(false);
        }
    };



    const handleSendOtp = async () => {
        // Validation
        if (phone.length < 5) {
            Alert.alert("Invalid Number", "Please enter a valid phone number.");
            return;
        }

        if (!recaptchaVerifier.current) {
            console.error("ReCaptcha Verifier is not ready.");
            Alert.alert("Error", "Authentication engine is initializing. Please try again in a moment.");
            return;
        }

        setIsLoading(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            // 3. Format phone number to strict E.164 (e.g. +91XXXXXXXXXX)
            const cleanPhone = phone.replace(/\D/g, ''); // Remove non-numbers
            const fullPhone = `${selectedCountry.dialCode}${cleanPhone}`;
            
            console.log("Sending OTP to:", fullPhone);

            // 4. Using the requested method signature for Expo compatibility
            // The third argument is the native recaptcha verifier
            const result = await signInWithPhoneNumber(auth, fullPhone, recaptchaVerifier.current);
            
            setConfirmationResult(result);
            setAuthMode('otp');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            console.log("OTP sent successfully, session ID available.");
            
        } catch (error: any) {
            console.error("Firebase Auth Error (Send OTP):", error.code, error.message);
            
            // Handle common Firebase errors
            if (error.code === 'auth/invalid-phone-number') {
                Alert.alert("Invalid Number", "The phone number provided is not valid.");
            } else if (error.code === 'auth/too-many-requests') {
                Alert.alert("Too Many Requests", "Take a break! We've blocked all requests from this device due to unusual activity. Try again later.");
            } else {
                Alert.alert("Authentication Error", error.message || "Failed to send verification code.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!confirmationResult) {
            Alert.alert("Session Expired", "Please request a new OTP.");
            setAuthMode('phone');
            return;
        }
        
        if (otp.length < 6) {
            Alert.alert("Invalid Code", "Please enter the 6-digit code.");
            return;
        }

        setIsLoading(true);
        try {
            console.log("Verifying OTP...");
            
            // 5. Confirm the code using the result from the previous step
            const userCredential = await confirmationResult.confirm(otp);
            const user = userCredential.user;

            console.log("Verification successful for UID:", user.uid);

            // 6. Persistence & Session Handover
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await AsyncStorage.setItem(AUTH_TOKEN_KEY, user.uid);
            setUserToken(user.uid);
            
            router.replace('/permissions');
        } catch (error: any) {
            console.error("Firebase Verification Error:", error.code, error.message);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            
            if (error.code === 'auth/invalid-verification-code') {
                Alert.alert("Invalid Code", "The OTP you entered is incorrect. Please check and try again.");
            } else if (error.code === 'auth/code-expired') {
                Alert.alert("Code Expired", "This OTP has expired. Please request a new one.");
            } else {
                Alert.alert("Verification Error", error.message || "Invalid verification code.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const renderCountryItem = ({ item }: { item: typeof COUNTRIES[0] }) => (
        <Pressable
            style={s.countryItem}
            onPress={() => {
                setSelectedCountry(item);
                setIsCountryModalVisible(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
        >
            <Text style={s.countryFlag}>{item.flag}</Text>
            <Text style={s.countryName}>{item.name}</Text>
            <Text style={s.countryDialCode}>{item.dialCode}</Text>
        </Pressable>
    );

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={s.container}>
                <LinearGradient colors={['#fff0f5', '#ffffff', '#fef1f6']} style={StyleSheet.absoluteFill} />

                {/* 7. RECAPTCHA MODAL: Crucial for native verification */}
                <FirebaseRecaptchaVerifierModal
                    ref={recaptchaVerifier}
                    firebaseConfig={auth.app.options}
                    // Styling the modal for better UX
                    title="Verification"
                    cancelLabel="Close"
                    attemptInvisibleVerification={true}
                />

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.keyboardView}
                >
                    <Animated.View entering={FadeInDown.delay(200).duration(800)} style={s.header}>
                        <View style={s.logoCircle}>
                            <Ionicons name="sparkles" size={40} color="#ff6b6b" />
                        </View>
                        <Text style={s.title}>Swipe to Wipe</Text>
                        <Text style={s.subtitle}>Clean your gallery in seconds ✨</Text>
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(400).duration(800)} style={s.form}>
                        {authMode === 'phone' && (
                            <View style={s.contentBlock}>
                                <Text style={s.label}>What's your number?</Text>
                                <View style={s.inputContainer}>
                                    <Pressable
                                        style={s.countryPicker}
                                        onPress={() => setIsCountryModalVisible(true)}
                                    >
                                        <Text style={s.countryCodeText}>{selectedCountry.flag} {selectedCountry.dialCode}</Text>
                                        <Ionicons name="chevron-down" size={14} color="#1f2937" style={{ marginLeft: 4 }} />
                                    </Pressable>
                                    <View style={s.vLine} />
                                    <TextInput
                                        style={s.input}
                                        placeholder="00000 00000"
                                        placeholderTextColor="#9ca3af"
                                        value={phone}
                                        onChangeText={(text) => setPhone(text.replace(/[^0-9]/g, ''))} // Native-friendly numeric input
                                        keyboardType="phone-pad"
                                        autoFocus
                                    />
                                </View>
                                <Pressable
                                    style={[s.primaryBtn, phone.length < 5 && s.disabledBtn]}
                                    onPress={handleSendOtp}
                                    disabled={isLoading || phone.length < 5}
                                >
                                    <LinearGradient colors={['#ff6b6b', '#ff8e53']} style={s.primaryGrad}>
                                        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnTxt}>Send OTP</Text>}
                                    </LinearGradient>
                                </Pressable>
                                <Pressable
                                    style={s.guestBtn}
                                    onPress={handleGuestMode}
                                    disabled={isLoading}
                                >
                                    <Text style={s.guestBtnTxt}>Continue as Guest</Text>
                                </Pressable>
                            </View>
                        )}

                        {authMode === 'otp' && (
                            <View style={s.contentBlock}>
                                <Text style={s.label}>Enter code sent to {selectedCountry.dialCode} {phone}</Text>
                                <View style={s.inputContainer}>
                                    <TextInput
                                        style={[s.input, { textAlign: 'center', letterSpacing: 10, fontSize: 24 }]}
                                        placeholder="000000"
                                        placeholderTextColor="#9ca3af"
                                        value={otp}
                                        onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, ''))}
                                        keyboardType="number-pad"
                                        maxLength={6}
                                        autoFocus
                                    />
                                </View>
                                <Pressable
                                    style={[s.primaryBtn, otp.length < 6 && s.disabledBtn]}
                                    onPress={handleVerifyOtp}
                                    disabled={isLoading || otp.length < 6}
                                >
                                    <LinearGradient colors={['#ff6b6b', '#ff8e53']} style={s.primaryGrad}>
                                        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnTxt}>Verify & Enter</Text>}
                                    </LinearGradient>
                                </Pressable>
                                <Pressable onPress={() => setAuthMode('phone')} style={s.backBtn}>
                                    <Text style={s.backBtnTxt}>Edit Number</Text>
                                </Pressable>
                              </View>
                        )}
                    </Animated.View>

                    <Animated.View entering={FadeInUp.delay(600).duration(800)} style={s.footer}>
                        <Text style={s.termsTxt}>
                            By continuing, you agree to our <Text style={s.link}>Terms</Text> and <Text style={s.link}>Privacy Policy</Text>.
                        </Text>
                    </Animated.View>
                </KeyboardAvoidingView>

                <Modal
                    visible={isCountryModalVisible}
                    animationType="slide"
                    transparent={true}
                    onRequestClose={() => setIsCountryModalVisible(false)}
                >
                    <View style={s.modalOverlay}>
                        <View style={s.modalContent}>
                            <View style={s.modalHeader}>
                                <Text style={s.modalTitle}>Select Country</Text>
                                <Pressable onPress={() => setIsCountryModalVisible(false)} style={s.closeBtn}>
                                    <Ionicons name="close" size={24} color="#1f2937" />
                                </Pressable>
                            </View>
                            <FlatList
                                data={COUNTRIES}
                                renderItem={renderCountryItem}
                                keyExtractor={(item) => item.dialCode + item.name}
                                contentContainerStyle={{ paddingBottom: 40 }}
                                showsVerticalScrollIndicator={false}
                            />
                        </View>
                    </View>
                </Modal>
            </View>
        </TouchableWithoutFeedback>
    );
}

const s = StyleSheet.create({
    container: { flex: 1 },
    keyboardView: { flex: 1, paddingHorizontal: 32, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 50 },
    logoCircle: {
        width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center', marginBottom: 20,
        shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1, shadowRadius: 20, elevation: 5,
    },
    title: { fontSize: 36, fontFamily: 'Syne_800ExtraBold', color: '#1f2937' },
    subtitle: { fontSize: 16, fontFamily: 'DMSans_400Regular', color: '#6b7280', marginTop: 8 },
    form: { width: '100%' },
    contentBlock: { gap: 16 },
    label: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#1f2937', textAlign: 'center', marginBottom: 8 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
        borderRadius: 20, paddingHorizontal: 20, height: 64,
        borderWidth: 1, borderColor: '#f3f4f6',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03, shadowRadius: 8, elevation: 2,
    },
    countryPicker: { flexDirection: 'row', alignItems: 'center', height: '100%' },
    countryCodeText: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#1f2937' },
    vLine: { width: 1, height: 24, backgroundColor: '#f3f4f6', marginHorizontal: 12 },
    input: { flex: 1, fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#1f2937' },
    primaryBtn: { height: 64, borderRadius: 20, overflow: 'hidden', marginTop: 8 },
    primaryGrad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    primaryBtnTxt: { fontSize: 18, fontFamily: 'DMSans_700Bold', color: '#fff' },
    disabledBtn: { opacity: 0.5 },
    guestBtn: { height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    guestBtnTxt: { fontSize: 16, fontFamily: 'DMSans_700Bold', color: '#6b7280' },
    backBtn: { alignSelf: 'center', marginTop: 8 },
    backBtnTxt: { fontSize: 14, fontFamily: 'DMSans_700Bold', color: '#ff6b6b' },
    footer: { marginTop: 40, alignItems: 'center' },
    termsTxt: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
    link: { color: '#ff6b6b', fontFamily: 'DMSans_700Bold' },
    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32,
        paddingTop: 24, paddingHorizontal: 24, maxHeight: H * 0.7,
    },
    modalHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 24, paddingHorizontal: 8,
    },
    modalTitle: { fontSize: 24, fontFamily: 'Syne_700Bold', color: '#1f2937' },
    closeBtn: { padding: 4 },
    countryItem: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 16,
        borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingHorizontal: 8,
    },
    countryFlag: { fontSize: 24, marginRight: 16 },
    countryName: { flex: 1, fontSize: 17, fontFamily: 'DMSans_500Medium', color: '#1f2937' },
    countryDialCode: { fontSize: 17, fontFamily: 'DMSans_700Bold', color: '#6b7280' },
});
