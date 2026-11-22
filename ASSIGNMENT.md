**Title:** Hotel Offer Orchestrator **Stack:** Node.js (TypeScript), Express, Temporal, Redis, Docker Compose 

# **Overview** 

Aggregate overlapping hotel offers from two mock suppliers, **dedupe** hotels, and **select the best offer** per hotel. Add the ability to filter hotels by price range. 

# **Objective** 

Build and deploy a system that: 

- Calls two mocked supplier hotel APIs 

- Compares hotel listings based on price 

- Returns the best-priced hotel for each name (de-duplicated) 

- Uses Temporal.io to orchestrate the comparison logic 

- Ability to filter hotel list by price range 

# **Functional Requirements** 

## **Endpoints** 

1. GET /api/hotels?city=delhi 

## **Workflow Behavior** 

- Use Temporal to orchestrate this process: 

   - Call Supplier A and Supplier B in parallel 

   - Each returns a list of hotels for the requested city 

   - Deduplicate hotels by name 

   - For each hotel name that appears in both lists: 

      - Select the one with the cheaper price 

      - If only one supplier returns a hotel, select that one 

- Return the final de-duplicated list to the client 

2. GET /api/hotels?city=delhi&minPrice=<min>&maxPrice=<max> 

- Deduplicated list must also be saved in Redis 

● Implement price filtering inside Redis 

# **Response Format** 

[ { "name": "Holtin", "price": 5340, "supplier": "Supplier B", "commissionPct": 20 }, { "name": "Radison", "price": 5900, "supplier": "Supplier A", "commissionPct": 13 } ] 

# **Mock Supplier APIs** 

Create two mock endpoints within your service: 

- GET /supplierA/hotels 

- GET /supplierB/hotels 

Each returns a static JSON array like: 

[ { "hotelId": "a1", "name": "Holtin", "price": 6000, "city": "delhi", "commissionPct": 10 } ] 

The values can be hardcoded or randomly selected, but **must include overlapping hotel names** between A and B for meaningful comparisons. 

# **DevOps Requirements** 

- Containerize the application using Docker 

# **Postman Collection** 

Create a Postman collection to test your API: 

- Valid city with expected overlaps (e.g. city=delhi ) 

- City with no results 

- Simulate one supplier being down (optional) 

# **Submission Checklist** 

- GitHub repository with: 

   - Source code 

   - Dockerfile 

   - README.md with clear setup & deployment steps 

   - Postman collection file ( .json ) 

# **Optional Bonus Point** 

- Health check endpoint ( /health ) must inform about the health of both the suppliers 

- Logging & error handling in activities/workflows 

