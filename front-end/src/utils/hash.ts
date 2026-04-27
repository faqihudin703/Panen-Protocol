/**
 * hash.ts — SHA-256 invoice hash untuk DeliveryReceipt
 * Tanpa farmer — petani didata off-chain via KYC service
 */

export interface InvoiceHashInput {
    koperasi:          string
    weight_kg:         number
    price_per_kg:      number
    invoice_value_idr: number
    gps_lat:           number
    gps_lon:           number
    delivery_month:    number
    delivery_year:     number
}

export async function hashInvoice(data: InvoiceHashInput): Promise<Uint8Array> {
    const canonical = JSON.stringify({
        koperasi:          data.koperasi,
        weight_kg:         data.weight_kg,
        price_per_kg:      data.price_per_kg,
        invoice_value_idr: data.invoice_value_idr,
        gps_lat:           data.gps_lat,
        gps_lon:           data.gps_lon,
        delivery_month:    data.delivery_month,
        delivery_year:     data.delivery_year,
    })

    const encoded = new TextEncoder().encode(canonical)
    const hashBuf = await crypto.subtle.digest("SHA-256", encoded)
    return new Uint8Array(hashBuf)
}
