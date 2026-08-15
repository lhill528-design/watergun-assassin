import { useCallback, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSignIn, useSignUp } from "@clerk/clerk-expo";

type Step = "email" | "code";
type Mode = "sign-in" | "sign-up";

function firstErrorMessage(err: unknown, fallback: string): string {
  const errors = (err as { errors?: Array<{ code?: string; message?: string }> })?.errors;
  return errors?.[0]?.message ?? fallback;
}

/**
 * Passwordless email OTP sign-in. Tries an existing-user sign-in first; if
 * the email isn't registered, falls back to starting a sign-up — same "just
 * enter your email" UX either way, no separate register screen.
 */
export function SignInForm() {
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();

  const [step, setStep] = useState<Step>("email");
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestCode = useCallback(async () => {
    if (!signInLoaded || !signUpLoaded || !signIn || !signUp) return;
    setError(null);
    setSubmitting(true);
    const trimmedEmail = email.trim();

    try {
      const attempt = await signIn.create({ identifier: trimmedEmail });
      const emailFactor = attempt.supportedFirstFactors?.find(
        (factor) => factor.strategy === "email_code",
      ) as { emailAddressId: string } | undefined;

      if (!emailFactor) {
        setError("Email code sign-in isn't available for this account.");
        return;
      }

      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: emailFactor.emailAddressId,
      });
      setMode("sign-in");
      setStep("code");
    } catch (err) {
      const notFound = (err as { errors?: Array<{ code?: string }> })?.errors?.some(
        (e) => e.code === "form_identifier_not_found",
      );
      if (!notFound) {
        setError(firstErrorMessage(err, "Couldn't send a code. Try again."));
        return;
      }

      try {
        await signUp.create({ emailAddress: trimmedEmail });
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setMode("sign-up");
        setStep("code");
      } catch (signUpErr) {
        setError(firstErrorMessage(signUpErr, "Couldn't send a code. Try again."));
      }
    } finally {
      setSubmitting(false);
    }
  }, [email, signInLoaded, signUpLoaded, signIn, signUp]);

  const verifyCode = useCallback(async () => {
    if (!signIn || !signUp) return;
    setError(null);
    setSubmitting(true);
    const trimmedCode = code.trim();

    try {
      if (mode === "sign-in") {
        const result = await signIn.attemptFirstFactor({ strategy: "email_code", code: trimmedCode });
        if (result.status === "complete") {
          await setActiveSignIn({ session: result.createdSessionId });
        } else {
          setError("Sign-in incomplete. Try again.");
        }
      } else {
        const result = await signUp.attemptEmailAddressVerification({ code: trimmedCode });
        if (result.status === "complete") {
          await setActiveSignUp({ session: result.createdSessionId });
        } else {
          setError("Sign-up incomplete. Try again.");
        }
      }
    } catch (err) {
      setError(firstErrorMessage(err, "Invalid code. Try again."));
    } finally {
      setSubmitting(false);
    }
  }, [mode, code, signIn, signUp, setActiveSignIn, setActiveSignUp]);

  if (step === "code") {
    return (
      <View className="w-full gap-3">
        <Text className="text-sm text-muted text-center">Enter the code sent to {email}</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          className="bg-surface border border-border rounded-xl px-4 py-3 text-center text-foreground text-lg tracking-widest"
          placeholderTextColor="#666"
        />
        {error ? <Text className="text-error text-sm text-center">{error}</Text> : null}
        <TouchableOpacity
          className="bg-primary px-8 py-4 rounded-full items-center"
          disabled={submitting || code.trim().length < 6}
          onPress={verifyCode}
        >
          {submitting ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text className="text-background font-bold text-lg">Verify & Sign In</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          <Text className="text-muted text-center text-sm">Use a different email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="w-full gap-3">
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground text-base"
        placeholderTextColor="#666"
      />
      {error ? <Text className="text-error text-sm text-center">{error}</Text> : null}
      <TouchableOpacity
        className="bg-primary px-8 py-4 rounded-full items-center"
        disabled={submitting || !email.includes("@")}
        onPress={requestCode}
      >
        {submitting ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text className="text-background font-bold text-lg">Sign In to Play</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
