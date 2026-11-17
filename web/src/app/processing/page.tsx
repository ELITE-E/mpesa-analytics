import { PageShell } from "@/components/layout/page-shell";
import { ProcessingHeader } from "@/components/processing/processing-header";
import { ProcessingHero } from "@/components/processing/processing-hero";
import { ProcessingPipeline } from "@/components/processing/processing-pipeline";

/**
 * Stitch screen: "Processing & Analyzing Statement" (15d69f3cf81a40d8b300bf6330866f05).
 * No navigation at any width, so the analysis cannot be left by accident.
 */
export default function ProcessingPage() {
  return (
    <PageShell header={<ProcessingHeader />} desktop={null} mainClassName="flex-1 w-full pt-16 bg-surface flex flex-col">
      <div className="flex flex-col w-full pb-10 lg:pt-6 max-w-2xl mx-auto">
        <ProcessingHero />
        <ProcessingPipeline />
      </div>
    </PageShell>
  );
}
