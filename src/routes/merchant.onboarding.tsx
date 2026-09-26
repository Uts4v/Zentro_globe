// src/routes/merchant.onboarding.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { merchantApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { LocationPicker } from "@/features/store-locator/components/LocationPicker";
import { toLatLng, type LatLng } from "@/features/store-locator/lib/geo";
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
import { ChevronDown } from "lucide-react";
import { COUNTRY_CODES, DEFAULT_DIAL_CODE } from "@/lib/country-codes";

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

function splitPhone(phone?: string | null): { dial: string; local: string } {
  const normalized = (phone ?? "").trim();
  if (!normalized) return { dial: DEFAULT_DIAL_CODE, local: "" };
  const match = COUNTRY_CODES.find((c) =>
    normalized.startsWith(`+${c.dial.replace("+", "")}`),
  );
  if (!match) return { dial: DEFAULT_DIAL_CODE, local: normalized };
  return { dial: match.dial, local: normalized.slice(match.dial.length).replace(/^[\s-]+/, "") };
}

function MerchantOnboardingPage() {
  const { merchantProfile, refreshMerchantProfile } = useAuth();
  const navigate = useNavigate();
  const initialPhone = splitPhone(merchantProfile?.phone);
  const [dialCode, setDialCode] = useState(initialPhone.dial);

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      business_name: merchantProfile?.business_name ?? "",
      slug: merchantProfile?.slug ?? "",
      address: merchantProfile?.address ?? "",
      phone: initialPhone.local,
      description: merchantProfile?.description ?? "",
    },
  });

  const [coords, setCoords] = useState<LatLng | null>(() =>
    toLatLng(merchantProfile?.latitude, merchantProfile?.longitude),
  );

  const updateProfileMutation = useMutation({
    mutationFn: (values: OnboardingFormValues) =>
      merchantApi.update({
        ...values,
        ...(coords
          ? { latitude: coords.lat.toFixed(6), longitude: coords.lng.toFixed(6) }
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
    updateProfileMutation.mutate({ ...values, phone: `${dialCode}${values.phone}` });
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
                <p className="text-sm font-medium">Map location</p>
                <LocationPicker value={coords} onChange={setCoords} />
                <p className="text-xs text-muted-foreground">
                  This pin is how nearby customers find you in Discover and see how far away you
                  are. You can change it later in Store settings.
                </p>
              </div>

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public Phone Number</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <div className="relative shrink-0">
                          <select
                            value={dialCode}
                            onChange={(e) => setDialCode(e.target.value)}
                            aria-label="Country code"
                            className="h-9 cursor-pointer appearance-none rounded-md border border-input bg-transparent pl-3 pr-7 text-base text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                          >
                            {COUNTRY_CODES.map((c) => (
                              <option key={c.code} value={c.dial}>
                                {c.flag} {c.name} ({c.dial})
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        </div>
                        <Input placeholder="Your business contact number" {...field} />
                      </div>
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
