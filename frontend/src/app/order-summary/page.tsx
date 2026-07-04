import Link from "next/link";

export default function OrderSummary() {
  return (
    <div className="min-h-screen bg-bg p-8 text-white flex flex-col items-center">
      <div className="w-full max-w-4xl flex justify-between items-center mb-12">
        <Link href="/" className="text-2xl font-bold tracking-wide bg-gradient-to-r from-primary via-purple-300 to-white bg-clip-text text-transparent">Aetheris AI</Link>
        <div className="w-10 h-10 rounded-full bg-primary bg-opacity-20 flex items-center justify-center border border-primary border-opacity-50 shadow-[0_0_15px_rgba(138,43,226,0.3)]">
          <span className="w-4 h-4 rounded-full bg-primary animate-pulse"></span>
        </div>
      </div>

      <div className="max-w-2xl w-full text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Confirm Your Order</h1>
        <p className="text-text-muted">Refined selection for your celestial experience.</p>
      </div>

      <div className="max-w-2xl w-full bg-surface rounded-3xl p-8 border border-white border-opacity-10">
        <div className="flex justify-between items-center pb-6 border-b border-white border-opacity-10 mb-6">
          <h2 className="text-lg font-medium text-primary">Your Selection</h2>
          <span className="bg-white bg-opacity-5 px-3 py-1 rounded-full text-xs text-text-muted">Est. 15 mins</span>
        </div>

        <div className="space-y-6 mb-8">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium text-lg">2x Wagyu Beef Burger</p>
              <p className="text-sm text-text-muted mt-1">Instructions: Medium-rare</p>
            </div>
            <p className="font-medium text-lg">$60.00</p>
          </div>
          <div className="flex justify-between items-start">
            <p className="font-medium text-lg">1x Truffle Fries</p>
            <p className="font-medium text-lg">$12.00</p>
          </div>
        </div>

        <div className="pt-6 border-t border-white border-opacity-10 space-y-4">
          <div className="flex justify-between text-sm text-text-muted">
            <span>Subtotal</span>
            <span>$84.00</span>
          </div>
          <div className="flex justify-between text-sm text-text-muted">
            <span>Tax (VAT 0%)</span>
            <span>$0.00</span>
          </div>
          <div className="flex justify-between text-2xl font-bold pt-4">
            <span>Grand Total</span>
            <span>$84.00</span>
          </div>
        </div>
      </div>

      <div className="mt-12 w-full max-w-2xl bg-surface rounded-full flex justify-between p-2">
        <button className="flex-1 py-3 text-text-muted hover:text-white flex items-center justify-center gap-2">Voice Assist</button>
        <button className="flex-1 py-3 text-text-muted hover:text-white flex items-center justify-center gap-2">Modify Order</button>
        <button className="flex-1 py-3 bg-primary text-white rounded-full font-medium flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(138,43,226,0.4)]">
          Confirm Order
        </button>
      </div>
    </div>
  );
}
