# Contact / Enquiry API (website → backend)

Website ke `/contact` page ka **"Send an enquiry"** form isi endpoint par submit hota hai.
Admin panel (`/contact`) yahi data padhta hai.

---

## 1. Endpoint

```
POST  {API_BASE_URL}/api/contact
```

| Environment | API_BASE_URL |
| --- | --- |
| Local backend | `http://localhost:5000` |
| Deployed backend | `https://<your-backend-host>` (jo bhi host par backend deploy hai) |

- Public endpoint — **koi token / auth nahi**.
- Rate limit: **20 requests / 10 min per IP** (cross karne par `429`).
- Same email + mobile + message 2 minute ke andar dobara aaye to naya record nahi banta — wahi enquiry `200` + `duplicate: true` ke saath wapas milti hai.

### Headers

```
Content-Type: application/json
```

---

## 2. Request body

```json
{
  "name": "Rahul Sharma",
  "mobile": "9876543210",
  "email": "rahul@example.com",
  "topic": "Personal Loan",
  "message": "Mujhe 5 lakh ka personal loan chahiye, salaried hoon."
}
```

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `name` | string | ✅ | 2–120 characters (website ka "Full Name") |
| `mobile` | string | ✅ | 10–15 digits (spaces, `+`, `-` allowed) |
| `email` | string | ✅ | valid email, lowercase store hota hai |
| `topic` | string | ➖ | "I'm interested in" ka label; blank/unknown → `Other` |
| `message` | string | ✅ | 5–2000 characters |
| `source` | string | ➖ | default `website-contact` (baad me kisi aur form se aaye to yahan naam bhejna) |

**Alias fields bhi accept hote hain** (site ka code rename karne ki zaroorat nahi):
`fullName` → name, `mobileNumber` / `phone` → mobile, `emailAddress` → email,
`interest` / `product` / `subject` → topic, `enquiry` / `remarks` → message.

### `topic` ke allowed values (website dropdown ka wahi list)

```
Personal Loan, Business Loan, Home Loan, Loan Against Property, Balance Transfer,
Vehicle Loan, Education Loan, Credit Card, Project Loan, Commercial Purchase,
Working Capital, Lease Rental Discounting, OD CC Limit, Loan Against Share,
Film Funding, NPA, Gold Loan, FDI, Franchisee, Other
```

Case/space ka farq ignore hota hai (`"personal loan"` → `Personal Loan`).

---

## 3. Responses

### 201 — enquiry save ho gayi

```json
{
  "success": true,
  "message": "Thanks! Your enquiry has been received. Our team will contact you shortly.",
  "duplicate": false,
  "enquiry": { "id": "6720f3c1a9b4e2d5f60a1b23", "receivedAt": "2026-11-05T10:42:11.004Z" }
}
```

### 200 — duplicate submit (double click / retry)

```json
{
  "success": true,
  "message": "We already have this enquiry — our team will contact you shortly.",
  "duplicate": true,
  "enquiry": { "id": "6720f3c1a9b4e2d5f60a1b23", "receivedAt": "2026-11-05T10:42:11.004Z" }
}
```

### 400 — validation fail

```json
{
  "success": false,
  "message": "Full name is required, A valid mobile number is required"
}
```

### 429 — rate limit

```json
{
  "success": false,
  "message": "Too many enquiries from this device. Please try again in a few minutes."
}
```

---

## 4. cURL test

```bash
curl -X POST https://<your-backend-host>/api/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rahul Sharma",
    "mobile": "9876543210",
    "email": "rahul@example.com",
    "topic": "Personal Loan",
    "message": "Mujhe 5 lakh ka personal loan chahiye."
  }'
```

---

## 5. Website me kaise bhejein (copy-paste)

`ContactPage` ke form state ke naam already `name`, `mobile`, `email`, `topic`, `message` jaisa hi hain —
sirf `submit` handler ye kar de:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; // e.g. https://<your-backend-host>

type EnquiryResponse = { success: boolean; message: string; duplicate?: boolean };

export const sendEnquiry = async (body: {
  name: string;
  mobile: string;
  email: string;
  topic: string;
  message: string;
}): Promise<EnquiryResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, source: "website-contact" }),
  });

  const data = (await response.json()) as EnquiryResponse;

  if (!response.ok) {
    throw new Error(data?.message || "Could not send your enquiry. Please try again.");
  }

  return data;
};
```

Component me:

```tsx
const [sending, setSending] = useState(false);
const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault();
  setSending(true);
  setStatus(null);
  try {
    const result = await sendEnquiry({ name, mobile, email, topic, message });
    setStatus({ type: "success", text: result.message });
    // form reset
  } catch (error) {
    setStatus({ type: "error", text: error instanceof Error ? error.message : "Something went wrong." });
  } finally {
    setSending(false);
  }
};
```

Site ko chahiye ek env var:

```
VITE_API_BASE_URL=https://<your-backend-host>
```

---

## 6. CORS (zaroori)

Backend sirf `FRONTEND_URL` aur `ADMIN_URL` origins allow karta hai (`src/app.js`).
Deployed backend ke env me website ka origin hona chahiye, warna browser me
`CORS policy` error aayega:

```
FRONTEND_URL=https://indexia-finance-web.vercel.app
```

(local testing ke liye `http://localhost:5173` jaisa site origin bhi add karna padega.)

---

## 7. Admin side (reference — panel already bana hua hai)

Yeh website ko call karne ki zaroorat nahi; admin panel inhe use karta hai.

```
GET    /api/admin/contacts?status=new|in-progress|closed&topic=&search=&page=1&limit=20
PATCH  /api/admin/contacts/:id          { "status": "in-progress", "note": "Callback 3 PM" }
DELETE /api/admin/contacts/:id
```

`GET` response:

```json
{
  "success": true,
  "enquiries": [
    {
      "id": "6720f3c1a9b4e2d5f60a1b23",
      "name": "Rahul Sharma",
      "mobile": "9876543210",
      "email": "rahul@example.com",
      "topic": "Personal Loan",
      "message": "Mujhe 5 lakh ka personal loan chahiye.",
      "source": "website-contact",
      "status": "new",
      "note": "",
      "handledByName": "",
      "handledAt": null,
      "receivedAt": "2026-11-05T10:42:11.004Z",
      "updatedAt": "2026-11-05T10:42:11.004Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "pages": 1,
  "stats": { "total": 1, "new": 1, "inProgress": 0, "closed": 0 }
}
```
