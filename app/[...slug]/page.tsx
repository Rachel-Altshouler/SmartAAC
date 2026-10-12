import { notFound } from "next/navigation";
import { SmartAACDemo } from "@/components/smartaac-demo";
import { pathToScreen } from "@/lib/screen-routes";

// "/child/..." and "/dashboard/..." open the same app as "/" — it shows the
// screen of the address. Any other address is "not found".
export default function ScreenPage({ params }: { params: { slug: string[] } }) {
  if (!pathToScreen(`/${params.slug.join("/")}`)) notFound();
  return <SmartAACDemo />;
}
