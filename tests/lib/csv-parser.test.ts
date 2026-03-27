import { describe, it, expect } from 'vitest'
import { parseCSV, type CSVRow } from '@/lib/utils/csv-parser'

describe('parseCSV', () => {
  describe('valid CSV parsing', () => {
    it('parses a valid CSV with standard columns', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,0,USD
2024-02-20,MSFT,sell,5,300.50,25,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual({
        date: expect.any(String),
        symbol: 'AAPL',
        type: 'buy',
        quantity: 10,
        price: 150.25,
        fees: 0,
        currency: 'USD',
        notes: undefined,
      })
      expect(result.rows[1].symbol).toBe('MSFT')
      expect(result.rows[1].type).toBe('sell')
      expect(result.rows[1].quantity).toBe(5)
    })

    it('handles column aliases (ticker -> symbol, qty -> quantity)', () => {
      const csv = `date,ticker,type,qty,price,fees,currency
2024-01-15,GOOGL,buy,20,140.00,50,EUR`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].symbol).toBe('GOOGL')
      expect(result.rows[0].quantity).toBe(20)
      expect(result.rows[0].currency).toBe('EUR')
    })

    it('handles action -> type column alias', () => {
      const csv = `date,symbol,action,quantity,price,fees,currency
2024-01-15,TSLA,buy,5,250.00,10,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].type).toBe('buy')
    })

    it('parses dividend transactions', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-03-15,AAPL,dividend,10,5.50,0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].type).toBe('dividend')
    })

    it('handles optional fees column (defaults to 0)', () => {
      const csv = `date,symbol,type,quantity,price,currency
2024-01-15,AAPL,buy,10,150.25,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].fees).toBe(0)
    })

    it('handles optional currency column (defaults to USD)', () => {
      const csv = `date,symbol,type,quantity,price,fees
2024-01-15,AAPL,buy,10,150.25,5`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].currency).toBe('USD')
    })

    it('parses optional notes column', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency,notes
2024-01-15,AAPL,buy,10,150.25,0,USD,Initial purchase`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].notes).toBe('Initial purchase')
    })

    it('handles different date formats (DD/MM/YYYY)', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
15/01/2024,AAPL,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].date).toBeTruthy()
    })

    it('handles different date formats (DD-MM-YYYY)', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
15-01-2024,AAPL,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
    })

    it('handles numbers with European decimal format (1.234,56)', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,"1.234,56",0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].price).toBeCloseTo(1234.56)
    })

    it('handles numbers with currency symbols and spaces', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,$150.25,€0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].price).toBe(150.25)
      expect(result.rows[0].fees).toBe(0)
    })

    it('handles semicolon-delimited CSV', () => {
      const csv = `date;symbol;type;quantity;price;fees;currency
2024-01-15;AAPL;buy;10;150.25;0;USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].symbol).toBe('AAPL')
    })

    it('handles tab-delimited CSV', () => {
      const csv = `date\tsymbol\ttype\tquantity\tprice\tfees\tcurrency
2024-01-15\tAAPL\tbuy\t10\t150.25\t0\tUSD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].symbol).toBe('AAPL')
    })

    it('handles quoted fields with commas', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency,notes
2024-01-15,AAPL,buy,10,150.25,0,USD,"Initial setup, lots of context"`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].notes).toBe('Initial setup, lots of context')
    })

    it('handles quoted fields with escaped quotes', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency,notes
2024-01-15,AAPL,buy,10,150.25,0,USD,"Quote ""test"" here"`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].notes).toContain('"test"')
    })

    it('strips UTF-8 BOM from text', () => {
      const csv = '\ufeffdate,symbol,type,quantity,price,fees,currency\n2024-01-15,AAPL,buy,10,150.25,0,USD'

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
    })

    it('handles zero quantity or price as invalid', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,0,150.25,0,USD
2024-01-15,MSFT,buy,10,0,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('missing columns', () => {
    it('detects missing required date column', () => {
      const csv = `symbol,type,quantity,price,fees,currency
AAPL,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('date')
      expect(result.rows).toHaveLength(0)
    })

    it('detects missing required symbol column', () => {
      const csv = `date,type,quantity,price,fees,currency
2024-01-15,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('symbol')
      expect(result.rows).toHaveLength(0)
    })

    it('detects missing required type column', () => {
      const csv = `date,symbol,quantity,price,fees,currency
2024-01-15,AAPL,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('type')
      expect(result.rows).toHaveLength(0)
    })

    it('detects missing required quantity column', () => {
      const csv = `date,symbol,type,price,fees,currency
2024-01-15,AAPL,buy,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('quantity')
      expect(result.rows).toHaveLength(0)
    })

    it('detects missing required price column', () => {
      const csv = `date,symbol,type,quantity,fees,currency
2024-01-15,AAPL,buy,10,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('price')
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('empty rows and edge cases', () => {
    it('ignores empty rows', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,0,USD

2024-02-20,MSFT,sell,5,300.50,25,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(2)
    })

    it('handles rows with only whitespace', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,0,USD
   
2024-02-20,MSFT,sell,5,300.50,25,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(2)
    })

    it('rejects file with only header', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects empty file', () => {
      const csv = ``

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects file with only whitespace', () => {
      const csv = `\n  \n\t\n`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('invalid data handling', () => {
    it('rejects invalid date format', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
not-a-date,AAPL,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects invalid symbol format', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,@@@,buy,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects invalid transaction type', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,transfer,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects unsupported currency', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,0,GBP`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('rejects negative fees', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,-5,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(0)
    })

    it('handles partial row failures (other rows pass)', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,0,USD
invalid-date,MSFT,buy,5,300.50,0,USD
2024-03-15,GOOGL,buy,15,140.00,0,USD`

      const result = parseCSV(csv)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].symbol).toBe('AAPL')
      expect(result.rows[1].symbol).toBe('GOOGL')
    })
  })

  describe('different number formats', () => {
    it('handles comma-separated thousands with dot decimal', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,1000,150.25,10.50,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].quantity).toBe(1000)
      expect(result.rows[0].price).toBe(150.25)
    })

    it('handles European format with dot thousands and comma decimal', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,1000,"1.234,56","10,50",USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].price).toBeCloseTo(1234.56)
      expect(result.rows[0].fees).toBeCloseTo(10.5)
    })

    it('handles amounts with currency symbols', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,$150.25,€0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].price).toBe(150.25)
    })

    it('handles dash as zero', () => {
      const csv = `date,symbol,type,quantity,price,fees,currency
2024-01-15,AAPL,buy,10,150.25,-,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows[0].fees).toBe(0)
    })
  })

  describe('Spanish language support', () => {
    it('handles Spanish column names', () => {
      const csv = `fecha,emisora,operación,títulos,precio,comisión,moneda
15/01/2024,AAPL,compra,10,150.25,0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].symbol).toBe('AAPL')
      expect(result.rows[0].type).toBe('buy')
    })

    it('handles Spanish transaction types (compra, venta, dividendo)', () => {
      const csv = `fecha,emisora,operación,títulos,precio,comisión,moneda
15/01/2024,AAPL,compra,10,150.25,0,USD
20/02/2024,MSFT,venta,5,300.50,25,USD
15/03/2024,GOOGL,dividendo,10,5.50,0,USD`

      const result = parseCSV(csv)
      expect(result.errors).toHaveLength(0)
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].type).toBe('buy')
      expect(result.rows[1].type).toBe('sell')
      expect(result.rows[2].type).toBe('dividend')
    })
  })
})
