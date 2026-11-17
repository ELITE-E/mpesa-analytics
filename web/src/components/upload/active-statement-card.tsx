import { Icon } from "@/components/icon";
import {
  activeStatement,
  formatStatementSize,
  type StatementMetadata,
} from "@/content/upload";

type ActiveStatementCardProps = {
  statement: StatementMetadata;
  onRemove: () => void;
};

/**
 * The statement chosen for upload: its name, period and size, Ready or
 * Pending, and Remove. Makes no verification claim (Stage 8b, C-16): the
 * app neither hashes the file nor uses an ID vault.
 */
export function ActiveStatementCard({ statement, onRemove }: ActiveStatementCardProps) {
  const { name, size, rows, period, isValidated } = statement;

  return (
    <div className="bg-surface-container-lowest rounded-xl p-4 border border-hairline shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {activeStatement.title}
          </span>
          {isValidated ? (
            <span className="px-2 py-0.5 rounded-pill bg-primary-fixed text-on-primary-fixed text-[10px] font-label font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-pill bg-primary" />
              {activeStatement.readyLabel}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-pill bg-surface-container text-on-surface-variant text-[10px] font-label font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-pill bg-outline" />
              {activeStatement.pendingLabel}
            </span>
          )}
        </div>
      </div>

      <div className="bg-surface-container-low rounded-lg p-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
            <Icon name="picture_as_pdf" size={22} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-headline text-xs font-bold text-on-surface truncate">
              {name}
            </span>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] font-body text-on-surface-variant">
              {period && (
                <>
                  <span className="font-label font-medium text-on-surface tabular-nums">
                    {period}
                  </span>
                  <span>•</span>
                </>
              )}
              <span className="font-label tabular-nums">{formatStatementSize(size)}</span>
            </div>
            <span className="text-[10px] font-body text-outline mt-1 flex items-center gap-1">
              <Icon
                name={isValidated ? "lock_open" : "schedule"}
                size={12}
                className="text-primary"
              />
              {isValidated
                ? `${activeStatement.unlockNote}${
                    rows !== null ? ` • ${rows.toLocaleString("en-KE")} Rows` : ""
                  }`
                : activeStatement.pendingNote}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-error text-xs font-medium font-body flex items-center gap-0.5 hover:underline shrink-0 p-1"
        >
          <Icon name="delete" size={14} />
          {activeStatement.removeLabel}
        </button>
      </div>
    </div>
  );
}
