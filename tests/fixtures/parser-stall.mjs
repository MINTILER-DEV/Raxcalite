process.on('message', input => { if (input.stall) while (true) {} else process.send({ result: 'recovered' }); });
