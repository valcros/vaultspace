# DataRoomPlus

## Open Source Enhancement Proposal

### Licensing, Product Positioning, MVP Foundations, and Aggressive V1 Roadmap

Version: 1.0  
Status: Suggested Enhancement Document  
Audience: Project authors and maintainers

---

# Executive Summary

This document proposes a strategic enhancement plan for DataRoomPlus so it can become a **truly open-source, self-hosted secure data room platform** capable of competing with commercial virtual data room (VDR) products.

The key recommendations are:

1. **Adopt AGPLv3 for the server**
2. **Expand positioning beyond investor data rooms**
3. **Add missing foundational MVP primitives**
4. **Make V1 aggressively competitive with commercial VDRs**
5. **Architect around auditability, permissions, previews, and jobs first**
6. **Treat AI and e-signatures as important, but secondary, after trust and workflow**

This proposal builds on the existing DataRoomPlus feature matrix and extends it into a more complete product and architecture strategy.

---

# 1. Licensing Strategy

## Current Issue

The current matrix lists **BSL 1.1** as the project license.

That is a source-available license, not a true open-source license. It helps prevent direct commercial competition, but it weakens the project’s credibility as a community-driven open-source alternative.

If the stated goal is:

- let the community fully use the software
- allow self-hosting and modification
- encourage contributions
- prevent a third party from turning the project into a closed hosted commercial service without contributing back

then the best fit is **AGPLv3**.

---

## Recommendation: Use AGPLv3 for the server

### Why AGPLv3 fits this project

AGPLv3 is a real open-source license that also protects against private SaaS forks.

If someone:

- modifies the software
- deploys it as a network-accessible service

they must provide the modified source code to the users of that service.

That makes AGPLv3 the strongest practical option for:

- open-source credibility
- community contribution
- SaaS anti-freeloading protection

### What AGPLv3 allows

Community members can:

- self-host the platform
- use it internally or externally
- modify it
- redistribute it under AGPL terms
- build businesses around hosting/supporting it, as long as they comply with AGPL

### What AGPLv3 prevents

A third party cannot:

- take the code
- modify it privately
- offer a hosted version
- keep all improvements closed

If they operate a modified hosted service, they must publish the modified source to the users of that service.

---

## Comparison with BSL

### BSL advantages

- blocks direct SaaS commercial competition
- gives maintainers stronger commercialization control

### BSL disadvantages

- not open source
- weaker contributor trust
- weaker adoption among open-source users
- weaker packaging and ecosystem participation

### AGPLv3 advantages

- true open source
- strong anti-closed-SaaS behavior
- trusted by open-source communities
- aligns better with the stated community goal

### AGPLv3 disadvantages

- some enterprises are cautious with AGPL
- legal review is sometimes stricter than MIT/Apache

---

## Recommended commercial strategy

Use this structure:

```text
Core server: AGPLv3
Hosted offering: commercial SaaS
Support/services: commercial
Optional enterprise add-ons: commercial only if clearly separated
```
