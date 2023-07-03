# Relay

This is an ultra simple transaction relay server, that does two things:
- Signs and sends transactions for keys held on the server
- Ensures transactions get mined

wip

## Routes

Right now it has two routes:
- `POST /key/:address/tx`
	- Create a new transaction for the address to sign and send off
	- Responds with a uuid since the original hash may be replaced
- `GET /tx/:id`
    - Get the status of a transaction