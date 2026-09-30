import {
  BedDouble,
  Cake,
  Coffee,
  Croissant,
  CupSoda,
  Dumbbell,
  Flower2,
  LayoutGrid,
  Pill,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  UtensilsCrossed,
  Wine,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Line icons for merchant categories (no emoji in the Offers UI). */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  "food-drink": UtensilsCrossed,
  cafe: Coffee,
  restaurant: UtensilsCrossed,
  bakery: Croissant,
  "bar-lounge": Wine,
  "fast-food": UtensilsCrossed,
  dessert: Cake,
  "juice-tea": CupSoda,
  "beauty-wellness": Sparkles,
  salon: Scissors,
  barber: Scissors,
  spa: Flower2,
  fitness: Dumbbell,
  retail: ShoppingBag,
  grocery: ShoppingCart,
  fashion: Shirt,
  electronics: Smartphone,
  pharmacy: Pill,
  stay: BedDouble,
  hotel: BedDouble,
  services: Wrench,
  "other-services": Wrench,
};

export function categoryIcon(slug: string | null | undefined): LucideIcon {
  return (slug && CATEGORY_ICONS[slug]) || Store;
}
