interface LineItem {
  description?: string;
  item?: string;
  qty?: number;
  unit_price?: number;
}

interface Props {
  status: string;
  missingItems: LineItem[];
  extraItems: LineItem[];
  leakCents: number;
}

export default function ReconciliationCard({ status, missingItems, extraItems, leakCents }: Props) {
  const isClean = status === 'clean';

  return (
    <section className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Three-Way Match</h2>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          isClean ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {isClean ? 'Clean' : 'Discrepancy'}
        </span>
      </div>

      {isClean ? (
        <p className="text-sm text-green-600">
          All field note items are present in the draft invoice.
        </p>
      ) : (
        <div className="space-y-4">
          {missingItems.length > 0 && (
            <div>
              <p className="text-xs font-medium text-red-600 mb-2">
                Missing from invoice ({missingItems.length} item{missingItems.length !== 1 ? 's' : ''})
              </p>
              <div className="space-y-1">
                {missingItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded-lg">
                    <span>{item.description ?? item.item ?? 'Unknown item'}</span>
                    {item.qty !== undefined && item.unit_price !== undefined && (
                      <span className="font-medium">${(item.qty * item.unit_price).toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {extraItems.length > 0 && (
            <div>
              <p className="text-xs font-medium text-orange-600 mb-2">
                On invoice but not in field notes ({extraItems.length} item{extraItems.length !== 1 ? 's' : ''})
              </p>
              <div className="space-y-1">
                {extraItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg">
                    <span>{item.description ?? item.item ?? 'Unknown item'}</span>
                    {item.qty !== undefined && item.unit_price !== undefined && (
                      <span className="font-medium">${(item.qty * item.unit_price).toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {leakCents > 0 && (
            <div className="pt-3 border-t border-gray-100 flex justify-between text-sm">
              <span className="font-medium text-gray-700">Estimated revenue leak</span>
              <span className="font-bold text-red-600">${(leakCents / 100).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
