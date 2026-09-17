// src/routes/merchant.onboarding.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { merchantApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

export const Route = createFileRoute("/merchant/onboarding")({
  component: MerchantOnboardingPage,
});

const onboardingSchema = z.object({
  business_name: z.string().min(3, "Name must be at least 3 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens")
    .optional()
    .or(z.literal("")),
  address: z.string().min(10, "Please provide a more detailed address"),
  phone: z.string().min(7, "Please provide a valid phone number"),
  description: z.string().optional(),
});

type OnboardingFormValues = z.infer<typeof onboardingSchema>;

function MerchantOnboardingPage() {
  const { merchantProfile, refreshMerchantProfile } = useAuth();
  const navigate = useNavigate();

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      business_name: merchantProfile?.business_name ?? "",
      slug: merchantProfile?.slug ?? "",
      address: merchantProfile?.address ?? "",
      phone: merchantProfile?.phone ?? "",
      description: merchantProfile?.description ?? "",
    },
  });

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError("Your browser doesn't support location.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser settings."
            : "Couldn't get your location. Try again.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const updateProfileMutation = useMutation({
    mutationFn: (values: OnboardingFormValues) =>
      merchantApi.update({
        ...values,
        ...(coords
          ? { latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) }
          : {}),
        onboarding_complete: true,
      }),
    onSuccess: async () => {
      toast.success("Profile saved! Welcome to your dashboard.");
      await refreshMerchantProfile();
      navigate({ to: "/merchant" as any, replace: true });
    },
    onError: (error: any) => {
      toast.error("Failed to save profile", {
        description: error?.response?.data?.detail ?? error.message,
      });
    },
  });

  const onSubmit = (values: OnboardingFormValues) => {
    updateProfileMutation.mutate(values);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Welcome to Zentro!</CardTitle>
          <CardDescription>
            Let's set up your business profile. You can change this later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="business_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., The Cozy Corner Cafe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your branded URL</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">/m/</span>
                        <Input placeholder="cafe-name" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea placeholder="123 Main Street, Anytown" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUseCurrentLocation}
                  disabled={locating}
                  className="w-full"
                >
                  {locating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LocateFixed className="h-4 w-4" />
                  )}
                  {coords ? "Location set · tap to update" : "Use my current location for the map"}
                </Button>
                {coords && !locating && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
                  </div>
                )}
                {locationError && <p className="text-xs text-destructive">{locationError}</p>}
                <p className="text-xs text-muted-foreground">
                  This pin lets customers find you on the café map and see distance. You can change
                  it later in Store settings.
                </p>
              </div>

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Your business contact number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell customers what makes your place special..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending ? "Saving..." : "Continue to Dashboard"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
