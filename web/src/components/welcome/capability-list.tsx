import { Icon } from "@/components/icon";
import {
  capabilities,
  capabilitiesSection,
  type Capability,
} from "@/content/welcome";

function CapabilityCard({ icon, tone, title, description }: Capability) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm flex items-start gap-3">
      <div
        className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5 ${tone}`}
      >
        <Icon name={icon} size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-headline text-xs font-semibold text-on-surface">{title}</h3>
        <p className="font-body text-xs text-on-surface-variant mt-0.5 leading-snug">
          {description}
        </p>
      </div>
    </div>
  );
}

export function CapabilityList() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="font-label text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
          {capabilitiesSection.title}
        </span>
        <span className="font-label text-[11px] text-primary font-medium">
          {capabilitiesSection.badge}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {capabilities.map((capability) => (
          <CapabilityCard key={capability.title} {...capability} />
        ))}
      </div>
    </div>
  );
}
