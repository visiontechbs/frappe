// Copyright (c) 2016, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Contact", {
	onload(frm) {
		frm.email_field = "email_id";
	},
	refresh: function (frm) {

		if (frm.doc.__islocal) {
			const last_doc = frappe.contacts.get_last_doc(frm);
			if (frappe.dynamic_link && frappe.dynamic_link.doc
				&& frappe.dynamic_link.doc.name == last_doc.docname) {
				frm.set_value('links', '');
				frm.add_child('links', {
					link_doctype: frappe.dynamic_link.doctype,
					link_name: frappe.dynamic_link.doc[frappe.dynamic_link.fieldname]
				});
			}
		}

		if (!frm.doc.user && !frm.is_new() && frm.perm[0].write) {
			frm.add_custom_button(__("Invite as User"), function () {
				return frappe.call({
					method: "frappe.contacts.doctype.contact.contact.invite_user",
					args: {
						contact: frm.doc.name
					},
					callback: function (r) {
						frm.set_value("user", r.message);
					}
				});
			});
		}
		frm.set_query('link_doctype', "links", function () {
			return {
				query: "frappe.contacts.address_and_contact.filter_dynamic_link_doctypes",
				filters: {
					fieldtype: "HTML",
					fieldname: "contact_html",
				}
			}
		});
		frm.refresh_field("links");

		let numbers = frm.doc.phone_nos;
		if (numbers && numbers.length && frappe.phone_call.handler) {
			frm.add_custom_button(__('Call'), () => {
				numbers = frm.doc.phone_nos
					.sort((prev, next) => next.is_primary_mobile_no - prev.is_primary_mobile_no)
					.map(d => d.phone);
				frappe.phone_call.handler(numbers);
			});
		}

		if (frm.doc.links) {
			frappe.call({
				method: "frappe.contacts.doctype.contact.contact.address_query",
				args: { links: frm.doc.links },
				callback: function (r) {
					if (r && r.message) {
						frm.set_query("address", function () {
							return {
								filters: {
									name: ["in", r.message],
								}
							}
						});
					}
				}
			});

			for (let i in frm.doc.links) {
				let link = frm.doc.links[i];
				frm.add_custom_button(__("{0}: {1}", [__(link.link_doctype), __(link.link_name)]), function () {
					frappe.set_route("Form", link.link_doctype, link.link_name);
				}, __("Links"));
			}
		}
	},
	validate: function (frm) {
		// clear linked customer / supplier / sales partner on saving...
		if (frm.doc.links) {
			frm.doc.links.forEach(function (d) {
				frappe.model.remove_from_locals(d.link_doctype, d.link_name);
			});
		}

		// Added by +AU
		if (parseInt(frm.doc.nominee_portion) > 100) {
			frappe.msgprint(__("Maximum Portion is 100"));
			frappe.validated = false;
		}

	},

	// Added by +AU
	nic: function (frm) {
		//first clear the feild
		frm.set_value('linked_with', "");
		//frappe ajax call for get database values
		frappe.call({
			method: 'frappe.client.get_value',
			args: {
				doctype: 'Member',
				filters: {
					'emp_nic': frm.doc.nic,
				},
				fieldname: ['name', 'member_name', 'email_id']
			},
			callback: function (data) {
				frm.set_value('linked_with', data.message.name);
				frm.refresh_field('linked_with');
			}
		});

		console.log(cur_frm.doc.linked_with);
	},

	after_save: function (frm) {
		frappe.run_serially([
			() => frappe.timeout(1),
			() => {
				const last_doc = frappe.contacts.get_last_doc(frm);
				if (frappe.dynamic_link && frappe.dynamic_link.doc && frappe.dynamic_link.doc.name == last_doc.docname) {
					for (let i in frm.doc.links) {
						let link = frm.doc.links[i];
						if (last_doc.doctype == link.link_doctype && last_doc.docname == link.link_name) {
							frappe.set_route('Form', last_doc.doctype, last_doc.docname);
						}
					}
				}
			}
		]);
	},
	sync_with_google_contacts: function (frm) {
		if (frm.doc.sync_with_google_contacts) {
			frappe.db.get_value("Google Contacts", { "email_id": frappe.session.user }, "name", (r) => {
				if (r && r.name) {
					frm.set_value("google_contacts", r.name);
				}
			})
		}
	},
	// Added by +AU - VBTS-44
	validate: function (frm) {
		// check total nominne portion is greater than 100%
		if (frm.doc.links.length) {
			var total_precentage = 0;
			$.each(frm.doc.links, function (i, d) {

				total_precentage = total_precentage + d.nominee_percentage;

			});

			if (total_precentage > 100) {
				frappe.msgprint("Total Nomminee's percentage is cannot be greater than 100%");
				frappe.validated = false;
			}
		}
	}
});

frappe.ui.form.on("Dynamic Link", {
	link_name: function (frm, cdt, cdn) {
		var child = locals[cdt][cdn];
		if (child.link_name) {
			frappe.model.with_doctype(child.link_doctype, function () {
				var title_field = frappe.get_meta(child.link_doctype).title_field || "name"
				frappe.model.get_value(child.link_doctype, child.link_name, title_field, function (r) {
					frappe.model.set_value(cdt, cdn, "link_title", r[title_field])
				})
			})
		}
	},
	// +AU - When allocating Nominne portion,execute this
	nominee_percentage: function (frm, cdt, cdn) {

		var child = locals[cdt][cdn];
		var child_row = child.idx;

		// portion cannot above 100%
		if (child.nominee_percentage > 100) {
			frappe.msgprint(__("Nominee Prtion cannot be exeed 100%"));
			child.nominee_percentage = "";
		// cannot enter a portion,without entering a specific member
		} else if (child.link_name == undefined || child.link_name == undefined) {
			frappe.msgprint(__("Please enter 'Link Document Type' and 'Link Name'"));
			child.nominee_percentage = "";
		} else {
			console.log(child.link_doctype);
			//get sum of portion for given Member
			frappe.call({
				method: "frappe.contacts.doctype.contact.contact.get_all_nominees",
				args: {
					link_doctype: child.link_doctype,
					link_name: child.link_name
				},
				callback: function (r) {
					console.log(r.message);
					if (r && r.message) {
						// check maximum portion is alocated 
						if (r.message[0].nominee_percentage >= 100) {
							frappe.msgprint(__("For this Member, already alocated Maximum Nominne Portions"));
							child.link_doctype = "";
							child.nominee_percentage = "";
							child.link_name = "";
						} else {
							var new_nominee_percentage = r.message[0].nominee_percentage + child.nominee_percentage;
							// check current given portion + already given portion sumation is exceed the 100%
							if (new_nominee_percentage > 100) {
								var balance_nominee_percentage = 100 - r.message[0].nominee_percentage;
								
								child.nominee_percentage = balance_nominee_percentage;
								frappe.msgprint(__("For this Member, you can allocate maximum portion is " + balance_nominee_percentage));
								child.nominee_percentage = "";
							}
						}
					}
				}
			});
		}
	}
})
